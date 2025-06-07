
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
    const pressUrls = await searchPressReleases(record.company_name, record.date_raised);
    console.log('Found press URLs:', pressUrls);

    // Extract investor contacts from the press releases
    const investorContacts = await extractInvestorContacts(pressUrls);
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

async function searchPressReleases(companyName: string, dateRaised: string): Promise<string[]> {
  const serpApiKey = Deno.env.get('SERP_API_KEY');
  if (!serpApiKey) {
    throw new Error('SERP_API_KEY not configured');
  }

  const query = `${companyName} funding press release ${dateRaised}`;
  console.log('Search query:', query);

  try {
    const response = await fetch(`https://serpapi.com/search?engine=google&q=${encodeURIComponent(query)}&api_key=${serpApiKey}&hl=en&gl=us&num=10`);
    
    if (!response.ok) {
      throw new Error(`SERP API error: ${response.statusText}`);
    }

    const data = await response.json();
    const organicResults = data.organic_results || [];
    
    const urls = organicResults.slice(0, 3).map((result: any) => result.link).filter(Boolean);
    
    // Pad with empty strings if we don't have 3 URLs
    while (urls.length < 3) {
      urls.push('');
    }
    
    return urls;
  } catch (error) {
    console.error('Error searching press releases:', error);
    return ['', '', ''];
  }
}

async function extractInvestorContacts(pressUrls: string[]): Promise<string> {
  const groqApiKey = Deno.env.get('GROQ_API_KEY');
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  // Filter out empty URLs
  const validUrls = pressUrls.filter(url => url && url.trim() !== '');
  
  if (validUrls.length === 0) {
    return 'No press releases found';
  }

  const prompt = `Given these press release URLs about a startup fundraising round:
${validUrls.join('\n')}

Please extract the names of people involved from the investor side (VCs, Angels, Firm Partners, Managing Directors, etc.) that might be mentioned in articles at these URLs.

Return the names in this format: Name (Company), Name (Company), Name (Company)

If you cannot determine specific individual names, return "Check URLs manually for investor contacts".`;

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
            content: 'You are a research assistant that extracts investor contact information from press release URLs. Focus on individual names and their companies.'
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
    return data.choices[0]?.message?.content || 'Unable to extract contacts';
  } catch (error) {
    console.error('Error extracting investor contacts:', error);
    return 'Error extracting contacts';
  }
}
