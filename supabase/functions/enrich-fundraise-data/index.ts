
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
    
    console.log('🔄 Processing record ID:', recordId);

    // Get the record from database
    const { data: record, error: fetchError } = await supabaseClient
      .from('fundraise_data')
      .select('*')
      .eq('id', recordId)
      .single();

    if (fetchError || !record) {
      throw new Error('Record not found');
    }

    console.log('📋 Found record:', record.company_name);

    // Update status to processing ONLY for this record
    const { error: statusError } = await supabaseClient
      .from('fundraise_data')
      .update({ status: 'processing' })
      .eq('id', recordId);

    if (statusError) {
      console.error('❌ Status update error:', statusError);
    }

    // Search for press releases with improved strategy
    console.log('🔍 Starting press release search...');
    const pressData = await searchAndExtractPressData(record.company_name, record.investors, record.date_raised);
    
    console.log('📰 Press data result:', pressData);

    // Update the record with enriched data
    const updateData = {
      press_url_1: pressData.urls[0] || 'N/A',
      press_url_2: pressData.urls[1] || 'N/A', 
      press_url_3: pressData.urls[2] || 'N/A',
      investor_contacts: pressData.investorNames || 'N/A',
      amount_raised: pressData.amountRaised || record.amount_raised,
      status: 'completed'
    };

    console.log('💾 Updating record with:', updateData);

    const { error: updateError } = await supabaseClient
      .from('fundraise_data')
      .update(updateData)
      .eq('id', recordId);

    if (updateError) {
      throw updateError;
    }

    console.log('✅ Successfully enriched record for:', record.company_name);

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Record enriched successfully',
      pressUrls: pressData.urls,
      enrichedData: {
        investorNames: pressData.investorNames,
        amountRaised: pressData.amountRaised
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('💥 Error in enrich-fundraise-data function:', error);

    // Update status to error for this specific record
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

async function searchAndExtractPressData(companyName: string, investors: string, dateRaised: string): Promise<{
  urls: string[],
  investorNames: string,
  amountRaised: string
}> {
  const serpApiKey = Deno.env.get('SERP_API_KEY');
  if (!serpApiKey) {
    console.error('❌ SERP_API_KEY not configured');
    return { urls: [], investorNames: 'N/A', amountRaised: 'N/A' };
  }

  // Convert Excel date format if needed
  let formattedDate = dateRaised;
  if (!isNaN(Number(dateRaised))) {
    const excelDate = new Date((Number(dateRaised) - 25569) * 86400 * 1000);
    formattedDate = excelDate.getFullYear().toString();
  }

  // Enhanced search queries with better targeting
  const searchQueries = [
    `"${companyName}" funding announcement ${formattedDate}`,
    `${companyName} raises funding ${investors}`,
    `${companyName} investment round ${formattedDate}`,
    `"${companyName}" press release funding`,
    `${companyName} startup investment news`
  ];

  let allUrls: string[] = [];
  let searchAttempts = 0;
  const maxSearches = 3; // Limit searches to avoid rate limits

  for (const query of searchQueries) {
    if (allUrls.length >= 3 || searchAttempts >= maxSearches) break;
    
    console.log(`🔎 Search attempt ${searchAttempts + 1}: "${query}"`);
    
    try {
      // Add delay between searches to avoid rate limiting
      if (searchAttempts > 0) {
        console.log('⏳ Waiting 2 seconds to avoid rate limits...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

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
        if (response.status === 429) {
          console.error('⚠️ Rate limit hit, stopping search');
          break;
        }
        console.error('🚫 SERP API error:', response.status, response.statusText);
        searchAttempts++;
        continue;
      }

      const data = await response.json();
      const organicResults = data.organic_results || [];
      
      console.log(`📊 Found ${organicResults.length} organic results`);
      
      const urls = organicResults
        .map((result: any) => result.link)
        .filter((url: string) => url && isRelevantPressUrl(url, companyName))
        .slice(0, 3);
      
      console.log(`✅ Filtered to ${urls.length} relevant URLs:`, urls);
      
      allUrls.push(...urls);
      allUrls = [...new Set(allUrls)]; // Remove duplicates
      
      searchAttempts++;
      
    } catch (error) {
      console.error('💥 Error in search query:', error);
      searchAttempts++;
      continue;
    }
  }
  
  // Ensure we have exactly 3 URLs
  const finalUrls = allUrls.slice(0, 3);
  console.log(`📋 Final URLs (${finalUrls.length}):`, finalUrls);
  
  if (finalUrls.length === 0) {
    console.log('❌ No URLs found, returning N/A values');
    return { urls: [], investorNames: 'N/A', amountRaised: 'N/A' };
  }

  // Extract content and get LLM analysis
  console.log('📄 Starting content extraction...');
  const extractedData = await extractDataFromUrls(finalUrls, companyName, investors);
  
  return {
    urls: finalUrls,
    investorNames: extractedData.investorNames,
    amountRaised: extractedData.amountRaised
  };
}

function isRelevantPressUrl(url: string, companyName: string): boolean {
  const relevantDomains = [
    'techcrunch.com', 'venturebeat.com', 'crunchbase.com', 'businesswire.com',
    'prnewswire.com', 'reuters.com', 'bloomberg.com', 'forbes.com',
    'wsj.com', 'ft.com', 'spacenews.com', 'spaceflightnow.com', 'yahoo.com',
    'finance.yahoo.com', 'marketwatch.com', 'benzinga.com', 'globenewswire.com',
    'spaceintelreport.com', 'satellitetoday.com', 'via-satellite.com'
  ];
  
  const urlLower = url.toLowerCase();
  const companyLower = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Check if URL contains relevant domains or company name
  const hasDomain = relevantDomains.some(domain => urlLower.includes(domain));
  const hasCompany = urlLower.includes(companyLower);
  const hasFundingKeywords = urlLower.includes('funding') || 
                           urlLower.includes('investment') || 
                           urlLower.includes('raise') ||
                           urlLower.includes('round') ||
                           urlLower.includes('capital');
  
  return hasDomain || hasCompany || hasFundingKeywords;
}

async function extractDataFromUrls(urls: string[], companyName: string, investors: string): Promise<{
  investorNames: string, 
  amountRaised: string
}> {
  let allTexts: string[] = [];
  
  console.log(`📥 Processing ${urls.length} URLs for content extraction...`);
  
  for (const url of urls) {
    console.log(`🌐 Fetching content from: ${url}`);
    
    try {
      const text = await fetchArticleContentWithFallbacks(url);
      if (text && text.length > 50) {
        allTexts.push(text);
        console.log(`✅ Extracted ${text.length} characters from ${url}`);
      } else {
        console.log(`⚠️ No meaningful content from ${url}`);
      }
    } catch (error) {
      console.error(`❌ Failed to fetch ${url}:`, error);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (allTexts.length === 0) {
    console.log('❌ No content extracted from any URL');
    return { investorNames: 'N/A', amountRaised: 'N/A' };
  }

  console.log(`📝 Successfully extracted content from ${allTexts.length} articles`);
  
  // Combine all texts and limit size for LLM
  const combinedText = allTexts.join('\n\n').slice(0, 12000);
  
  console.log('🤖 Sending to LLM for analysis...');
  
  // Extract investor names and amount using LLM in parallel
  const [investorNames, amountRaised] = await Promise.all([
    extractInvestorNamesWithLLM(combinedText, companyName),
    extractAmountRaisedWithLLM(combinedText, companyName)
  ]);
  
  return { investorNames, amountRaised };
}

async function fetchArticleContentWithFallbacks(url: string): Promise<string> {
  const blockedDomains = ['facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com'];
  if (blockedDomains.some(domain => url.includes(domain))) {
    console.log(`🚫 Skipping blocked domain: ${url}`);
    return '';
  }

  // Multiple user agents for better success rate
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];

  for (let attempt = 0; attempt < userAgents.length; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt + 1} for ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgents[attempt],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const text = extractTextFromHTML(html);
      
      if (text.length > 50) {
        return text;
      }
      
    } catch (error) {
      console.error(`❌ Attempt ${attempt + 1} failed for ${url}:`, error);
      
      if (attempt < userAgents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  return '';
}

function extractTextFromHTML(html: string): string {
  let text = '';
  
  // Try multiple extraction strategies
  const strategies = [
    // Strategy 1: Article tags
    /<article[^>]*>(.*?)<\/article>/gis,
    // Strategy 2: Main content
    /<main[^>]*>(.*?)<\/main>/gis,
    // Strategy 3: Content divs
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/gis,
    /<div[^>]*class="[^"]*article[^"]*"[^>]*>(.*?)<\/div>/gis,
    /<div[^>]*class="[^"]*post[^"]*"[^>]*>(.*?)<\/div>/gis,
    // Strategy 4: Paragraph content
    /<p[^>]*>(.*?)<\/p>/gis
  ];
  
  for (const pattern of strategies) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      text = matches.join(' ');
      if (text.length > 200) break; // Good enough content found
    }
  }
  
  // Clean up HTML and decode entities
  text = text
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  
  return text;
}

async function extractInvestorNamesWithLLM(text: string, companyName: string): Promise<string> {
  const groqApiKey = Deno.env.get('GROQ_API_KEY');
  if (!groqApiKey) {
    console.error('❌ GROQ_API_KEY not configured');
    return 'N/A';
  }

  const prompt = `You are a financial analyst extracting investor information from press releases about ${companyName}.

TASK: Extract the names of individual people who represent INVESTORS (VCs, venture capitalists, partners, managing directors, etc.) in this funding announcement.

INSTRUCTIONS:
- Extract FULL NAMES of PEOPLE who work at investor firms
- Format as: "First Last (Firm Name)"
- Example: "Brayton Williams (Boost VC), Nicole Velho (Sie Ventures)"
- Only return actual human names with their firms
- If no individual names are found, return "N/A"
- Do not include company executives or founders

ARTICLE TEXT:
${text.slice(0, 6000)}

EXTRACT INVESTOR NAMES:`;

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
            content: 'You are a precise financial analyst who extracts investor names from press releases. Focus only on individual people from investor firms, not company executives.'
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
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || 'N/A';
    
    console.log('🤖 LLM Investor Names Result:', result);
    
    // Validate result
    if (result.toLowerCase().includes('n/a') || 
        result.toLowerCase().includes('no individual') || 
        result.toLowerCase().includes('no people') ||
        result.toLowerCase().includes('not mentioned') ||
        result.trim().length < 3) {
      return 'N/A';
    }
    
    return result.trim();
  } catch (error) {
    console.error('💥 Error extracting investor names:', error);
    return 'N/A';
  }
}

async function extractAmountRaisedWithLLM(text: string, companyName: string): Promise<string> {
  const groqApiKey = Deno.env.get('GROQ_API_KEY');
  if (!groqApiKey) {
    console.error('❌ GROQ_API_KEY not configured');
    return 'N/A';
  }

  const prompt = `Extract the funding amount raised by ${companyName} from this press release.

INSTRUCTIONS:
- Look for funding amounts in formats like "$5M", "$10 million", "$2.5B", "€1.2M", etc.
- Return the amount in a clean format like "$5M" or "$10 million"
- If no amount is mentioned, return "N/A"
- Only return the numerical amount with currency symbol
- Look for phrases like "raised", "funding", "investment", "round"

ARTICLE TEXT:
${text.slice(0, 6000)}

FUNDING AMOUNT:`;

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
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || 'N/A';
    
    console.log('🤖 LLM Amount Raised Result:', result);
    
    // Validate result
    if (result.toLowerCase().includes('n/a') || 
        result.toLowerCase().includes('no amount') ||
        result.toLowerCase().includes('not mentioned') ||
        result.trim().length < 2) {
      return 'N/A';
    }
    
    return result.trim();
  } catch (error) {
    console.error('💥 Error extracting amount raised:', error);
    return 'N/A';
  }
}
