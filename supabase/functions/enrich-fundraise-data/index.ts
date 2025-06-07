
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

    // Extract investor contacts from the press releases
    const investorContacts = await extractInvestorContacts(pressUrls, record.company_name);
    console.log('Extracted investor contacts:', investorContacts);

    // Update the record with enriched data
    const { error: updateError } = await supabaseClient
      .from('fundraise_data')
      .update({
        press_url_1: pressUrls[0] || null,
        press_url_2: pressUrls[1] || null,
        press_url_3: pressUrls[2] || null,
        investor_contacts: investorContacts,
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
      investorContacts
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

  // Primary search query similar to your working code
  const query = `${companyName} funding ${investors} press release`;
  console.log('Search query:', query);
  
  try {
    const params = new URLSearchParams({
      q: query,
      api_key: serpApiKey,
      num: '10',
      engine: 'google',
      hl: 'en',
      gl: 'us'
    });

    const response = await fetch(`https://serpapi.com/search?${params.toString()}`);
    
    if (!response.ok) {
      console.error('SERP API error:', response.status, response.statusText);
      
      // Fallback to broader search
      console.log('Trying broader search...');
      const fallbackParams = new URLSearchParams({
        q: `${companyName} funding news`,
        api_key: serpApiKey,
        num: '10',
        engine: 'google'
      });
      
      const fallbackResponse = await fetch(`https://serpapi.com/search?${fallbackParams.toString()}`);
      if (!fallbackResponse.ok) {
        throw new Error(`SERP API error: ${fallbackResponse.statusText}`);
      }
      
      const fallbackData = await fallbackResponse.json();
      const fallbackResults = fallbackData.organic_results || [];
      const urls = fallbackResults.slice(0, 3).map((result: any) => result.link).filter((url: string) => url);
      
      // Pad with empty strings if needed
      while (urls.length < 3) {
        urls.push('N/A');
      }
      
      return urls;
    }

    const data = await response.json();
    const organicResults = data.organic_results || [];
    
    const urls = organicResults
      .slice(0, 3)
      .map((result: any) => result.link)
      .filter((url: string) => url && isRelevantPressUrl(url, companyName));
    
    // Pad with N/A if we don't have enough URLs
    while (urls.length < 3) {
      urls.push('N/A');
    }
    
    return urls;
    
  } catch (error) {
    console.error('Error in search query:', error);
    return ['N/A', 'N/A', 'N/A'];
  }
}

function isRelevantPressUrl(url: string, companyName: string): boolean {
  const relevantDomains = [
    'techcrunch.com', 'venturebeat.com', 'crunchbase.com', 'businesswire.com',
    'prnewswire.com', 'reuters.com', 'bloomberg.com', 'forbes.com',
    'wsj.com', 'ft.com', 'spacenews.com', 'spaceflightnow.com'
  ];
  
  return relevantDomains.some(domain => url.includes(domain)) || 
         url.toLowerCase().includes(companyName.toLowerCase().replace(/\s+/g, ''));
}

async function fetchArticleText(url: string): Promise<string> {
  if (url === 'N/A') {
    return '';
  }

  // Blocked domains that typically block scrapers
  const blockedDomains = ['facebook.com', 'twitter.com', 'linkedin.com'];
  if (blockedDomains.some(domain => url.includes(domain))) {
    console.log(`Skipping blocked domain: ${url}`);
    return '';
  }

  try {
    console.log(`Fetching article from: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.statusText}`);
      return '';
    }

    const html = await response.text();
    
    // Simple text extraction - look for common content patterns
    const textMatch = html.match(/<p[^>]*>(.*?)<\/p>/gi);
    if (textMatch) {
      const text = textMatch
        .map(p => p.replace(/<[^>]*>/g, '').trim())
        .filter(text => text.length > 50)
        .join(' ')
        .slice(0, 2000); // Limit text size
      
      return text;
    }
    
    return '';
  } catch (error) {
    console.error(`Error fetching article from ${url}:`, error);
    return '';
  }
}

async function extractInvestorContacts(pressUrls: string[], companyName: string): Promise<string> {
  const groqApiKey = Deno.env.get('GROQ_API_KEY');
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  // Filter out N/A URLs
  const validUrls = pressUrls.filter(url => url && url !== 'N/A');
  
  if (validUrls.length === 0) {
    return 'N/A';
  }

  // Fetch text from all valid URLs
  const allTexts: string[] = [];
  for (const url of validUrls) {
    const text = await fetchArticleText(url);
    if (text) {
      allTexts.push(text);
    }
  }

  const combinedText = allTexts.join('\n\n').slice(0, 4000); // Limit total text
  
  if (!combinedText.trim()) {
    return 'N/A';
  }

  const prompt = `You are a helpful analyst extracting **investor-side individuals** from press releases.

Instructions:
- Extract full names of people who represent the INVESTORS (VCs, Angels, Funds, etc.)
- Add their **firm** in parentheses: John Smith (Sequoia)
- Only return actual human names, NOT organizations alone
- Return "N/A" if no people are named.

Example Output:
Sarah Kim (Accel), Anil Gupta (SoftBank)

Article:
${combinedText}`;

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
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.statusText}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || 'N/A';
    
    console.log('LLM CONTENT:', result);
    
    // Clean up the result
    if (result.includes('N/A') || result.toLowerCase().includes('no individual') || result.toLowerCase().includes('no people')) {
      return 'N/A';
    }
    
    return result.trim();
  } catch (error) {
    console.error('Error extracting investor contacts:', error);
    return 'N/A';
  }
}
