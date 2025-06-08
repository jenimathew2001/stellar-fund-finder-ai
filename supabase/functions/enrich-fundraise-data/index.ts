import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface FundraiseData {
  id: string;
  company_name: string;
  date_raised: string;
  amount_raised: string;
  investors: string;
  press_url_1?: string;
  press_url_2?: string;
  press_url_3?: string;
  investor_contacts?: string;
  status: "pending" | "processing" | "completed" | "error";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const record: FundraiseData = await req.json();
    console.log("🔄 Processing record:", record.company_name);

    // Search for press releases with SERP API first, then GPT fallback
    const enrichedData = await enrichRecordData(record);

    console.log("✅ Final enriched data:", enrichedData);

    const response: FundraiseData = {
      ...record,
      ...enrichedData,
      status: "completed",
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("💥 Error in enrich-fundraise-data function:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Unknown error occurred",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function enrichRecordData(record: FundraiseData): Promise<Partial<FundraiseData>> {
  console.log(`🚀 Starting enrichment for ${record.company_name}`);
  
  // Step 1: Try SERP API approach
  console.log("📡 Attempting SERP API approach...");
  const serpResult = await trySerp(record);
  
  if (serpResult.success && serpResult.urls.length > 0) {
    console.log("✅ SERP API successful, extracting content...");
    const extractedData = await extractDataFromUrls(serpResult.urls, record);
    
    if (extractedData.investor_contacts !== "N/A" || extractedData.amount_raised !== "N/A") {
      return {
        press_url_1: serpResult.urls[0] || "N/A",
        press_url_2: serpResult.urls[1] || "N/A",
        press_url_3: serpResult.urls[2] || "N/A",
        investor_contacts: extractedData.investor_contacts,
        amount_raised: extractedData.amount_raised,
      };
    }
  }
  
  console.log("🤖 SERP failed, trying GPT fallback...");
  // Step 2: GPT fallback approach
  const gptResult = await tryGPTFallback(record);
  
  return {
    press_url_1: gptResult.urls[0] || "N/A",
    press_url_2: gptResult.urls[1] || "N/A", 
    press_url_3: gptResult.urls[2] || "N/A",
    investor_contacts: gptResult.investor_contacts,
    amount_raised: gptResult.amount_raised,
  };
}

async function trySerp(record: FundraiseData): Promise<{success: boolean, urls: string[]}> {
  const serpApiKey = Deno.env.get("SERP_API_KEY");
  if (!serpApiKey) {
    console.error("❌ SERP_API_KEY not configured");
    return {success: false, urls: []};
  }

  try {
    // Format date if available
    let dateStr = "";
    if (record.date_raised && record.date_raised !== "Not specified") {
      const date = new Date(record.date_raised);
      if (!isNaN(date.getTime())) {
        dateStr = date.getFullYear().toString();
      }
    }

    // Construct a simple, direct query
    const query = `${record.company_name} funding press release ${dateStr}`.trim();
    console.log(`🔍 Searching with query: "${query}"`);

    const response = await fetch(
      `https://serpapi.com/search?q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=10&engine=google&hl=en&gl=us`
    );

    if (!response.ok) {
      throw new Error(`SERP API error: ${response.status}`);
    }

    const data = await response.json();
    const organicResults = data.organic_results || [];
    
    console.log(`📊 Found ${organicResults.length} results`);

    // Filter for press release URLs
    const pressReleaseDomains = [
      "businesswire.com",
      "prnewswire.com", 
      "globenewswire.com",
      "techcrunch.com",
      "venturebeat.com",
      "reuters.com",
      "bloomberg.com",
      "yahoo.com/finance",
      "benzinga.com",
    ];

    const urls = organicResults
      .filter((result: any) => {
        const url = result.link.toLowerCase();
        return pressReleaseDomains.some(domain => url.includes(domain));
      })
      .map((result: any) => result.link)
      .slice(0, 3);

    console.log(`✅ Found press release URLs:`, urls);
    
    return {
      success: urls.length > 0,
      urls: urls
    };
  } catch (error) {
    console.error("❌ SERP search failed:", error);
    return {success: false, urls: []};
  }
}

function isPressReleaseUrl(url: string, companyName: string): boolean {
  const urlLower = url.toLowerCase();
  const companyLower = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Priority domains for press releases
  const pressReleaseDomains = [
    "businesswire.com",
    "prnewswire.com", 
    "globenewswire.com",
    "techcrunch.com",
    "venturebeat.com",
    "reuters.com",
    "bloomberg.com",
    "yahoo.com/finance",
    "benzinga.com",
  ];

  const hasPressReleaseDomain = pressReleaseDomains.some(domain => urlLower.includes(domain));
  const hasCompanyName = urlLower.includes(companyLower);
  const hasFundingKeywords = urlLower.includes("funding") || 
                             urlLower.includes("investment") || 
                             urlLower.includes("raise") || 
                             urlLower.includes("round") ||
                             urlLower.includes("announcement");

  return hasPressReleaseDomain || (hasCompanyName && hasFundingKeywords);
}

async function extractDataFromUrls(urls: string[], record: FundraiseData): Promise<{
  investor_contacts: string;
  amount_raised: string;
}> {
  console.log(`📥 Extracting content from ${urls.length} URLs...`);

  let allTexts: string[] = [];

  for (const url of urls.slice(0, 3)) {
    console.log(`🌐 Processing: ${url}`);
    
    try {
      const text = await fetchUrlContent(url);
      if (text && text.length > 200) {
        allTexts.push(text);
        console.log(`✅ Extracted ${text.length} characters`);
      } else {
        console.log(`⚠️ Insufficient content from ${url}`);
      }
    } catch (error) {
      console.error(`❌ Failed to extract from ${url}:`, error);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (allTexts.length === 0) {
    console.log("❌ No content extracted from URLs");
    return { investor_contacts: "N/A", amount_raised: "N/A" };
  }

  const combinedText = allTexts.join("\n\n").slice(0, 12000);
  console.log(`📝 Combined text length: ${combinedText.length} characters`);

  // Extract data using LLM
  const [investorNames, amountRaised] = await Promise.all([
    extractInvestorNamesWithLLM(combinedText, record.company_name, record.investors),
    extractAmountRaisedWithLLM(combinedText, record.company_name),
  ]);

  return { 
    investor_contacts: investorNames, 
    amount_raised: amountRaised 
  };
}

async function fetchUrlContent(url: string): Promise<string> {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ];

  for (let attempt = 0; attempt < userAgents.length; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt + 1} for ${url}`);

      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgents[attempt],
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const text = extractTextFromHTML(html);

      if (text.length > 200) {
        return text;
      }
    } catch (error) {
      console.error(`❌ Attempt ${attempt + 1} failed:`, error);
      if (attempt < userAgents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  return "";
}

function extractTextFromHTML(html: string): string {
  // Multiple content extraction strategies
  const strategies = [
    /<article[^>]*>(.*?)<\/article>/gis,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/gis,
    /<div[^>]*class="[^"]*article[^"]*"[^>]*>(.*?)<\/div>/gis,
    /<main[^>]*>(.*?)<\/main>/gis,
    /<p[^>]*>(.*?)<\/p>/gis,
  ];

  let text = "";
  for (const pattern of strategies) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      text = matches.join(" ");
      if (text.length > 1000) break;
    }
  }

  // Clean up HTML and decode entities
  text = text
    .replace(/<script[^>]*>.*?<\/script>/gis, "")
    .replace(/<style[^>]*>.*?<\/style>/gis, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

async function extractInvestorNamesWithLLM(
  text: string,
  companyName: string,
  knownInvestors: string
): Promise<string> {
  const groqApiKey = Deno.env.get("GROQ_API_KEY");
  if (!groqApiKey) {
    console.error("❌ GROQ_API_KEY not configured");
    return "N/A";
  }

  const prompt = `Extract investor information from this press release about ${companyName}'s funding round.

CONTEXT:
Company: ${companyName}
Known Investors: ${knownInvestors}

TASK:
1. Find INDIVIDUAL PEOPLE who are investors or represent investment firms
2. Include their full names and associated firms
3. Focus on lead investors, partners, managing directors, and key decision-makers
4. DO NOT include employees or executives of ${companyName}

FORMAT:
- Return names as: "Full Name (Firm Name)"
- Separate multiple investors with commas
- Example: "John Smith (Acme Ventures), Jane Doe (XYZ Capital)"
- If no individual names found, return "N/A"

PRESS RELEASE TEXT:
${text.slice(0, 6000)}

Return ONLY the formatted investor names:`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [
          {
            role: "system",
            content: "You are a precise extractor of investor information from press releases. Return only properly formatted investor names or 'N/A'."
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || "N/A";

    console.log("🤖 Extracted investor names:", result);

    // Validate the result format
    if (
      result.toLowerCase().includes("n/a") ||
      result.toLowerCase().includes("no individual") ||
      result.toLowerCase().includes("not found") ||
      !result.includes("(") || // Must have parentheses for firm names
      result.trim().length < 5
    ) {
      return "N/A";
    }

    return result.trim();
  } catch (error) {
    console.error("💥 Error extracting investor names:", error);
    return "N/A";
  }
}

async function extractAmountRaisedWithLLM(
  text: string,
  companyName: string
): Promise<string> {
  const groqApiKey = Deno.env.get("GROQ_API_KEY");
  if (!groqApiKey) {
    console.error("❌ GROQ_API_KEY not configured");
    return "N/A";
  }

  const prompt = `Extract the exact funding amount raised by ${companyName} from this press release.

INSTRUCTIONS:
- Look for funding amounts like "$5M", "$10 million", "$2.5B", etc.
- Return the amount exactly as written (e.g., "$5M" or "$10 million")
- If no specific amount mentioned, return "N/A"
- Look for phrases like "raised", "funding", "investment", "round", "secured"

ARTICLE TEXT:
${text.slice(0, 6000)}

Return only the funding amount:`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [
          {
            role: "system",
            content: "You extract funding amounts from press releases. Return only the amount or 'N/A'.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || "N/A";

    console.log("🤖 LLM Amount Result:", result);

    if (
      result.toLowerCase().includes("n/a") ||
      result.toLowerCase().includes("no amount") ||
      result.trim().length < 2
    ) {
      return "N/A";
    }

    return result.trim();
  } catch (error) {
    console.error("💥 Error extracting amount:", error);
    return "N/A";
  }
}

async function tryGPTFallback(record: FundraiseData): Promise<{
  urls: string[];
  investor_contacts: string;
  amount_raised: string;
}> {
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) {
    console.error("❌ OPENAI_API_KEY not configured for fallback");
    return {
      urls: [],
      investor_contacts: "N/A",
      amount_raised: "N/A",
    };
  }

  const prompt = `Find press release URLs and extract funding information for ${record.company_name}.

Company: ${record.company_name}
Known Investors: ${record.investors}
Date Raised: ${record.date_raised}

Please provide:
1. 3 press release URLs about their funding
2. Individual investor names in format "Name (Firm)"
3. Amount raised

Return in JSON format:
{
  "urls": ["url1", "url2", "url3"],
  "investor_contacts": "Name (Firm), Name (Firm)",
  "amount_raised": "$X million"
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a research assistant. Find press releases and extract funding information. Return valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || "";

    console.log("🤖 GPT Fallback Result:", result);

    try {
      const parsed = JSON.parse(result);
      return {
        urls: parsed.urls || [],
        investor_contacts: parsed.investor_contacts || "N/A",
        amount_raised: parsed.amount_raised || "N/A",
      };
    } catch (parseError) {
      console.error("❌ Failed to parse GPT response:", parseError);
      return {
        urls: [],
        investor_contacts: "N/A",
        amount_raised: "N/A",
      };
    }
  } catch (error) {
    console.error("💥 GPT fallback failed:", error);
    return {
      urls: [],
      investor_contacts: "N/A",
      amount_raised: "N/A",
    };
  }
}
