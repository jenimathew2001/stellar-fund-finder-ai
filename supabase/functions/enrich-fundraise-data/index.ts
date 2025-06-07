
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FundraiseData {
  id: string;
  company_name: string;
  date_raised: string;
  amount_raised: string;
  investors: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );

    const { recordId } = await req.json();
    
    console.log('Processing record ID:', recordId);

    // Get the record from database
    const { data: record, error: fetchError } = await supabaseClient
      .from('fundraise_data')
      .select('*')
      .eq('id', recordId)
      .single();

    if (fetchError || !record) {
      throw new Error('Record not found');
    }

    console.log('Found record:', record);

    // Update status to processing
    await supabaseClient
      .from('fundraise_data')
      .update({ status: 'processing' })
      .eq('id', recordId);

    // Search for press releases using SERP API
    const pressUrls = await searchPressReleases(record.company_name, record.investors);
    console.log('Found press URLs:', pressUrls);

    // Extract data from press releases with multiple fallbacks
    const enrichedData = await extractDataFromUrls(pressUrls, record.company_name, record.investors);
    console.log('Extracted enriched data:', enrichedData);

    // Update the record with enriched data
    const { error: updateError } = await supabaseClient
      .from('fundraise_data')
      .update({
        press_url_1: pressUrls[0] || 'N/A',
        press_url_2: pressUrls[1] || 'N/A',
        press_url_3: pressUrls[2] || 'N/A',
        investor_contacts: enrichedData.investorNames,
        amount_raised: enrichedData.amountRaised || record.amount_raised,
        status: 'completed'
      })
      .eq('id', recordId);

    if (updateError) {
      throw updateError;
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Record enriched successfully',
      pressUrls,
      enrichedData
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in enrich-fundraise-data function:', error);

    // Update status to error if we have a recordId
    try {
      const { recordId } = await req.json();
      if (recordId) {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        );
        
        await supabaseClient
          .from('fundraise_data')
          .update({ status: 'error' })
          .eq('id', recordId);
      }
    } catch (e) {
      console.error('Failed to update error status:', e);
    }

    return new Response(JSON.stringify({ 
      error: error.message || 'Unknown error occurred' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function searchPressReleases(companyName: string, investors: string): Promise<string[]> {
  const serpApiKey = Deno.env.get('SERP_API_KEY');
  if (!serpApiKey) {
    throw new Error('SERP_API_KEY not configured');
  }

  // Multiple search strategies
  const searchQueries = [
    `"${companyName}" funding "${investors}" press release`,
    `${companyName} raises funding ${investors}`,
    `${companyName} investment ${investors} announcement`,
    `${companyName} funding round press release`,
    `${companyName} startup funding news`
  ];

  let allUrls: string[] = [];

  for (const query of searchQueries) {
    if (allUrls.length >= 3) break;
    
    console.log('Searching with query:', query);
    
    try {
      const params = new URLSearchParams({
        q: query,
        api_key: serpApiKey,
        num: '5',
        engine: 'google',
        hl: 'en',
        gl: 'us'
      });

      const response = await fetch(`https://serpapi.com/search?${params.toString()}`);
      
      if (!response.ok) {
        console.error('SERP API error:', response.status, response.statusText);
        continue;
      }

      const data = await response.json();
      const organicResults = data.organic_results || [];
      
      const urls = organicResults
        .map((result: any) => result.link)
        .filter((url: string) => url && isRelevantPressUrl(url, companyName))
        .slice(0, 3);
      
      allUrls.push(...urls);
      
      // Remove duplicates
      allUrls = [...new Set(allUrls)];
      
    } catch (error) {
      console.error('Error in search query:', error);
      continue;
    }
  }
  
  // Ensure we have exactly 3 URLs, pad with N/A if needed
  const finalUrls = allUrls.slice(0, 3);
  while (finalUrls.length < 3) {
    finalUrls.push('N/A');
  }
  
  return finalUrls;
}

function isRelevantPressUrl(url: string, companyName: string): boolean {
  const relevantDomains = [
    'techcrunch.com', 'venturebeat.com', 'crunchbase.com', 'businesswire.com',
    'prnewswire.com', 'reuters.com', 'bloomberg.com', 'forbes.com',
    'wsj.com', 'ft.com', 'spacenews.com', 'spaceflightnow.com', 'yahoo.com',
    'finance.yahoo.com', 'marketwatch.com', 'benzinga.com', 'globenewswire.com'
  ];
  
  const urlLower = url.toLowerCase();
  const companyLower = companyName.toLowerCase().replace(/\s+/g, '');
  
  return relevantDomains.some(domain => urlLower.includes(domain)) || 
         urlLower.includes(companyLower) ||
         urlLower.includes('funding') ||
         urlLower.includes('investment') ||
         urlLower.includes('press');
}

async function extractDataFromUrls(urls: string[], companyName: string, investors: string): Promise<{investorNames: string, amountRaised: string}> {
  const validUrls = urls.filter(url => url && url !== 'N/A');
  
  if (validUrls.length === 0) {
    return { investorNames: 'N/A', amountRaised: 'N/A' };
  }

  let allTexts: string[] = [];
  
  // Try multiple fallback methods to get content
  for (const url of validUrls) {
    console.log(`Attempting to fetch content from: ${url}`);
    
    // Method 1: Direct fetch with different user agents
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ];
    
    for (const userAgent of userAgents) {
      try {
        const text = await fetchArticleContent(url, userAgent);
        if (text && text.length > 100) {
          allTexts.push(text);
          console.log(`Successfully extracted ${text.length} characters from ${url}`);
          break;
        }
      } catch (error) {
        console.error(`Failed to fetch with user agent ${userAgent}:`, error);
        continue;
      }
    }
  }

  if (allTexts.length === 0) {
    console.log('No content extracted from any URL');
    return { investorNames: 'N/A', amountRaised: 'N/A' };
  }

  // Combine all texts and limit size for LLM
  const combinedText = allTexts.join('\n\n').slice(0, 8000);
  
  // Extract investor names and amount using LLM
  const investorNames = await extractInvestorNames(combinedText, companyName);
  const amountRaised = await extractAmountRaised(combinedText, companyName);
  
  return { investorNames, amountRaised };
}

async function fetchArticleContent(url: string, userAgent: string): Promise<string> {
  const blockedDomains = ['facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com'];
  if (blockedDomains.some(domain => url.includes(domain))) {
    console.log(`Skipping blocked domain: ${url}`);
    return '';
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Extract text content using multiple strategies
    let text = '';
    
    // Strategy 1: Look for article content in common tags
    const articlePatterns = [
      /<article[^>]*>(.*?)<\/article>/gis,
      /<main[^>]*>(.*?)<\/main>/gis,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/gis,
      /<div[^>]*class="[^"]*article[^"]*"[^>]*>(.*?)<\/div>/gis
    ];
    
    for (const pattern of articlePatterns) {
      const matches = html.match(pattern);
      if (matches && matches[0]) {
        text = matches[0];
        break;
      }
    }
    
    // Strategy 2: Extract all paragraph content if no article found
    if (!text) {
      const pMatches = html.match(/<p[^>]*>(.*?)<\/p>/gis);
      if (pMatches) {
        text = pMatches.join(' ');
      }
    }
    
    // Clean up HTML tags and decode entities
    text = text
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    
    return text;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return '';
  }
}

async function extractInvestorNames(text: string, companyName: string): Promise<string> {
  const groqApiKey = Deno.env.get('GROQ_API_KEY');
  if (!groqApiKey) {
    console.error('GROQ_API_KEY not configured');
    return 'N/A';
  }

  const prompt = `You are a financial analyst extracting investor information from press releases.

Extract the names of individual people who represent INVESTORS (VCs, venture capitalists, partners, etc.) in this funding announcement for ${companyName}.

Instructions:
- Extract full names of PEOPLE who work at investor firms
- Format: "First Last (Firm Name)"
- Example: "Brayton Williams (Boost VC), Nicole Velho (Sie Ventures)"
- Only return actual human names with their firms
- If no individual names are found, return "N/A"

Article text:
${text.slice(0, 4000)}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content: 'You are a financial analyst who extracts investor names from press releases. Focus on individual people, not just company names.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.statusText}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || 'N/A';
    
    console.log('LLM Investor Names Result:', result);
    
    if (result.toLowerCase().includes('n/a') || result.toLowerCase().includes('no individual') || result.toLowerCase().includes('no people')) {
      return 'N/A';
    }
    
    return result.trim();
  } catch (error) {
    console.error('Error extracting investor names:', error);
    return 'N/A';
  }
}

async function extractAmountRaised(text: string, companyName: string): Promise<string> {
  const groqApiKey = Deno.env.get('GROQ_API_KEY');
  if (!groqApiKey) {
    console.error('GROQ_API_KEY not configured');
    return 'N/A';
  }

  const prompt = `Extract the funding amount raised by ${companyName} from this press release.

Instructions:
- Look for funding amounts in formats like "$5M", "$10 million", "$2.5B", etc.
- Return the amount in a clean format like "$5M" or "$10 million"
- If no amount is mentioned, return "N/A"
- Only return the numerical amount with currency symbol

Article text:
${text.slice(0, 4000)}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content: 'You are a financial analyst who extracts funding amounts from press releases. Be precise and only return the amount.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.statusText}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || 'N/A';
    
    console.log('LLM Amount Raised Result:', result);
    
    if (result.toLowerCase().includes('n/a') || result.toLowerCase().includes('no amount')) {
      return 'N/A';
    }
    
    return result.trim();
  } catch (error) {
    console.error('Error extracting amount raised:', error);
    return 'N/A';
  }
}
