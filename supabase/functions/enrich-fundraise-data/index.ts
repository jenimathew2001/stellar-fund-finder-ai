import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

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

interface AnalyzedUrl {
  url: string;
  keywordCount: number;
  keywords: string[];
}

interface ExtractedData {
  investor_contacts: string;
  amount_raised: string;
  urls: string[];
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

/**
 * Main function to enrich fundraise data. The process follows these steps:
 * 1. Try GPT-4 first to get URLs, amount, and investor info
 * 2. Validate GPT-4 provided URLs by checking content
 * 3. If needed, use SERP to find additional URLs
 * 4. Extract and verify information from valid URLs
 * 5. Final GPT-4 attempt if any information is missing
 */
async function enrichRecordData(record: FundraiseData): Promise<Partial<FundraiseData>> {
  console.log(`\n🚀 Starting enrichment for ${record.company_name}`);
  
  // Step 1: Try GPT-4 first for all information
  console.log("\n🤖 Attempting GPT-4 for initial data gathering...");
  const gptResult = await tryGPT4Initial(record);
  
  // Step 2: Validate URLs from GPT-4
  console.log("\n🔍 Validating GPT-4 provided URLs...");
  const validatedUrls = await validateAndAnalyzeUrls(gptResult.urls, record.company_name);
  
  let finalUrls = validatedUrls;
  let finalInvestorContacts = gptResult.investor_contacts;
  let finalAmount = gptResult.amount_raised;

  // Step 3: If not enough valid URLs, use SERP to find more
  if (validatedUrls.length < 3) {
    console.log(`\n⚠️ Only found ${validatedUrls.length} valid URLs from GPT-4, trying SERP for more...`);
    const remainingCount = 3 - validatedUrls.length;
    const serpResult = await trySerpForRemaining(record, remainingCount, validatedUrls);
    finalUrls = [...validatedUrls, ...serpResult.urls].slice(0, 3); // Ensure max 3 URLs
  }

  // Step 4: Extract information from valid URLs if needed
  if (finalUrls.length > 0 && (finalAmount === "N/A" || finalInvestorContacts === "N/A")) {
    console.log("\n📑 Extracting information from validated URLs...");
    const extractedData = await extractDataFromUrls(finalUrls, record);
    
    if (finalAmount === "N/A") finalAmount = extractedData.amount_raised;
    if (finalInvestorContacts === "N/A") finalInvestorContacts = extractedData.investor_contacts;
  }

  // Step 5: Final validation and GPT-4 attempt if needed
  if (!isEnrichmentComplete(finalUrls, finalAmount, finalInvestorContacts)) {
    console.log("\n⚠️ Enrichment incomplete, trying one final GPT-4 attempt...");
    const finalAttempt = await tryFinalGPT4Attempt(record, finalUrls, finalAmount, finalInvestorContacts);
    
    if (finalAmount === "N/A") finalAmount = finalAttempt.amount_raised;
    if (finalInvestorContacts === "N/A") finalInvestorContacts = finalAttempt.investor_contacts;
    if (finalUrls.length < 3) {
      const newUrls = await validateAndAnalyzeUrls(finalAttempt.urls, record.company_name);
      finalUrls = [...new Set([...finalUrls, ...newUrls])].slice(0, 3);
    }
  }

  return {
    press_url_1: finalUrls[0] || "N/A",
    press_url_2: finalUrls[1] || "N/A",
    press_url_3: finalUrls[2] || "N/A",
    investor_contacts: finalInvestorContacts,
    amount_raised: finalAmount
  };
}

/**
 * Initial GPT-4 attempt to get all required information.
 * Uses high confidence threshold to ensure quality results.
 */
async function tryGPT4Initial(record: FundraiseData): Promise<{
  urls: string[];
  investor_contacts: string;
  amount_raised: string;
}> {
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) {
    console.error("❌ OPENAI_API_KEY not configured");
    return { urls: [], investor_contacts: "N/A", amount_raised: "N/A" };
  }

  const prompt = `Find accurate information about ${record.company_name}'s funding round.

Company: ${record.company_name}
Known Investors: ${record.investors || 'Unknown'}
Date: ${record.date_raised || 'Recent'}

Tasks:
1. Find 3 most relevant press release or news URLs about this funding round
   - Focus on official press releases, major tech news sites, or financial news
   - Ensure URLs are specific to this company and funding round
   - Prioritize: businesswire.com, prnewswire.com, globenewswire.com, techcrunch.com, reuters.com

2. Identify individual investors or investment firm representatives
   - Find specific people who led or participated in the investment
   - Include their roles and firms
   - Format as: "Full Name (Role, Firm)"

3. Determine the exact funding amount raised
   - Include currency symbol
   - Use standard format like "$100 million" or "€50M"

Return in JSON format:
{
  "urls": ["url1", "url2", "url3"],
  "investor_contacts": "Name (Role, Firm), Name2 (Role, Firm2)",
  "amount_raised": "$X million",
  "confidence_score": 0.9
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert in venture capital research. Provide accurate, verified information only."
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0]?.message?.content || "{}");
    
    console.log("🤖 GPT-4 Initial Result:", result);
    
    // Only accept results with high confidence
    if (result.confidence_score && result.confidence_score >= 0.8) {
      return {
        urls: result.urls || [],
        investor_contacts: result.investor_contacts || "N/A",
        amount_raised: result.amount_raised || "N/A"
      };
    } else {
      console.log("⚠️ Low confidence in GPT-4 results, treating as N/A");
      return { urls: [], investor_contacts: "N/A", amount_raised: "N/A" };
    }
  } catch (error) {
    console.error("❌ GPT-4 initial attempt failed:", error);
    return { urls: [], investor_contacts: "N/A", amount_raised: "N/A" };
  }
}

/**
 * Validates URLs by checking their content for relevance.
 * A URL is considered valid if:
 * 1. Content is accessible
 * 2. Contains the company name
 * 3. Has enough funding-related keywords
 * 4. Comes from reputable sources
 */
async function validateAndAnalyzeUrls(urls: string[], companyName: string): Promise<string[]> {
  const validUrls: {url: string; relevanceScore: number}[] = [];
  
  for (const url of urls) {
    try {
      console.log(`\n🔍 Validating URL: ${url}`);
      const content = await fetchUrlContent(url);
      
      if (!content) {
        console.log('⚠️ No content found');
        continue;
      }

      const companyNameLower = companyName.toLowerCase();
      const contentLower = content.toLowerCase();
      
      if (!contentLower.includes(companyNameLower)) {
        console.log('⚠️ Company name not found in content');
        continue;
      }

      // Calculate relevance score based on keywords and source
      let relevanceScore = 0;
      const fundingKeywords = ['funding', 'investment', 'raises', 'raised', 'round', 'capital'];
      const foundKeywords = fundingKeywords.filter(keyword => 
        contentLower.includes(keyword.toLowerCase())
      );

      relevanceScore = foundKeywords.length;

      // Boost score for reputable sources
      if (url.includes('press-release') || url.includes('news')) relevanceScore += 1;
      if (/businesswire\.com|prnewswire\.com|globenewswire\.com/.test(url)) relevanceScore += 2;
      if (/techcrunch\.com|reuters\.com|bloomberg\.com/.test(url)) relevanceScore += 1;

      if (relevanceScore >= 2) {
        console.log(`✅ Valid URL found! Relevance score: ${relevanceScore}`);
        validUrls.push({url, relevanceScore});
      } else {
        console.log(`⚠️ URL failed relevance check (score: ${relevanceScore})`);
      }
    } catch (error) {
      console.log(`❌ Error validating URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Return unique URLs sorted by relevance
  return Array.from(new Set(
    validUrls
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .map(item => item.url)
  ));
}

/**
 * Uses SERP API to find additional URLs when GPT-4 results are insufficient.
 * Focuses on press releases and tech news sites.
 */
async function trySerpForRemaining(
  record: FundraiseData, 
  count: number, 
  existingUrls: string[]
): Promise<{urls: string[]}> {
  const serpApiKey = Deno.env.get("SERP_API_KEY");
  if (!serpApiKey) {
    console.error("❌ SERP_API_KEY not configured");
    return {urls: []};
  }

  try {
    const query = `${record.company_name} funding press release ${record.date_raised} site:businesswire.com OR site:prnewswire.com OR site:globenewswire.com OR site:techcrunch.com`;
    console.log(`\n🔍 SERP search for remaining URLs: "${query}"`);

    const response = await fetch(
      `https://serpapi.com/search.json?` + new URLSearchParams({
        q: query,
        api_key: serpApiKey,
        hl: "en",
        gl: "us",
        num: "10" // Get more results for better filtering
      })
    );

    if (!response.ok) {
      throw new Error(`SERP API error: ${response.status}`);
    }

    const data = await response.json();
    const results = data.organic_results || [];
    
    // Filter out existing URLs and validate new ones
    const newUrls = results
      .map((result: any) => result.link)
      .filter((url: string) => !existingUrls.includes(url));
    
    const validatedNewUrls = await validateAndAnalyzeUrls(newUrls, record.company_name);
    
    return {
      urls: validatedNewUrls.slice(0, count)
    };
  } catch (error) {
    console.error("❌ SERP search failed:", error);
    return {urls: []};
  }
}

/**
 * Checks if we have all required information:
 * - 3 valid URLs
 * - Valid amount raised
 * - Valid investor contacts
 */
function isEnrichmentComplete(
  urls: string[], 
  amount: string, 
  investorContacts: string
): boolean {
  return (
    urls.length === 3 && 
    amount !== "N/A" && 
    investorContacts !== "N/A"
  );
}

/**
 * Final attempt using GPT-4 to fill any missing information.
 * Uses current partial results as context.
 */
async function tryFinalGPT4Attempt(
  record: FundraiseData,
  currentUrls: string[],
  currentAmount: string,
  currentInvestors: string
): Promise<{
  urls: string[];
  investor_contacts: string;
  amount_raised: string;
}> {
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) {
    return {
      urls: [],
      investor_contacts: "N/A",
      amount_raised: "N/A"
    };
  }

  const prompt = `Final attempt to complete missing information for ${record.company_name}'s funding round.

Current Information:
- URLs found: ${currentUrls.join(", ")}
- Amount raised: ${currentAmount}
- Investor contacts: ${currentInvestors}

Company: ${record.company_name}
Known Investors: ${record.investors || 'Unknown'}
Date: ${record.date_raised || 'Recent'}

Task: Fill in any missing information:
1. If fewer than 3 URLs: Find additional relevant press release URLs
2. If amount is N/A: Determine the funding amount
3. If investor contacts are N/A: Identify specific investors

Use your knowledge of the venture capital industry and recent funding rounds.
Provide high-confidence information only.

Return in JSON format:
{
  "urls": ["url1", "url2", "url3"],
  "investor_contacts": "Name (Role, Firm), Name2 (Role, Firm2)",
  "amount_raised": "$X million",
  "confidence_score": 0.9
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert in venture capital research. Provide only high-confidence information to complete the missing data."
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0]?.message?.content || "{}");
    
    console.log("🤖 GPT-4 Final Attempt Result:", result);
    
    if (result.confidence_score && result.confidence_score >= 0.8) {
      return {
        urls: result.urls || [],
        investor_contacts: result.investor_contacts || "N/A",
        amount_raised: result.amount_raised || "N/A"
      };
    } else {
      console.log("⚠️ Low confidence in GPT-4 results, keeping existing values");
      return {
        urls: [],
        investor_contacts: "N/A",
        amount_raised: "N/A"
      };
    }
  } catch (error) {
    console.error("❌ GPT-4 final attempt failed:", error);
    return {
      urls: [],
      investor_contacts: "N/A",
      amount_raised: "N/A"
    };
  }
}

async function extractDataFromUrls(urls: string[], record: FundraiseData): Promise<ExtractedData> {
  console.log("\n📑 Extracting content from URLs...");

  // Collect content from all URLs
  const urlContents: string[] = [];
  for (const url of urls) {
    if (url === "N/A") continue;
    
    try {
      console.log(`\n🌐 Fetching content from: ${url}`);
      const content = await fetchUrlContent(url);
      if (content) {
        console.log("  ✅ Content fetched successfully");
        console.log(`  📝 Content length: ${content.length} characters`);
        urlContents.push(content);
      } else {
        console.log("  ⚠️ No content found");
      }
    } catch (error) {
      console.log(`  ❌ Error fetching content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  if (urlContents.length === 0) {
    console.log("❌ No content could be extracted from any URL");
    return {
      investor_contacts: "N/A",
      amount_raised: record.amount_raised || "N/A",
      urls: urls
    };
  }

  // Combine all content for analysis
  const combinedContent = urlContents.join("\n\n=== Next Article ===\n\n");
  console.log(`📊 Successfully extracted content from ${urlContents.length} URLs`);

  // Use LLaMA to extract investor information
  try {
    console.log("\n🦙 Using LLaMA to extract investor information...");
    const investorInfo = await extractInvestorNamesWithLLM(
      combinedContent,
      record.company_name,
      record.investors || ''
    );
    console.log(`✅ Extracted investor information: ${investorInfo}`);

    // Extract amount if not already provided
    let amount = record.amount_raised;
    if (!amount || amount === "N/A") {
      console.log("\n💰 Extracting funding amount...");
      amount = await extractAmountWithLLM(combinedContent, record.company_name);
      console.log(`✅ Extracted amount: ${amount}`);
    } else {
      console.log(`\n💰 Using provided amount: ${amount}`);
    }

  return { 
      investor_contacts: investorInfo,
      amount_raised: amount,
      urls: urls
    };
  } catch (error) {
    console.log(`❌ Error extracting information with LLaMA: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      investor_contacts: "N/A",
      amount_raised: record.amount_raised || "N/A",
      urls: urls
  };
  }
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
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  
  if (!groqApiKey && !openaiApiKey) {
    console.error("❌ Neither GROQ_API_KEY nor OPENAI_API_KEY configured");
    return "N/A";
  }

  // Try multiple approaches in sequence
  let result = "N/A";

  // 1. Try Groq first if available
  if (groqApiKey) {
    try {
      result = await tryGroqExtraction(text, companyName, knownInvestors, groqApiKey);
      if (result !== "N/A") {
        console.log("✅ Successfully extracted investors using Groq");
        return result;
      }
    } catch (error) {
      if (error.message === "Rate limit" && openaiApiKey) {
        console.log("⚠️ Groq API rate limit hit, trying OpenAI");
      } else {
        console.error("❌ Groq extraction failed:", error);
      }
    }
  }

  // 2. Try OpenAI if available
  if (openaiApiKey) {
    try {
      result = await tryOpenAIExtraction(text, companyName, knownInvestors, openaiApiKey);
      if (result !== "N/A") {
        console.log("✅ Successfully extracted investors using OpenAI");
        return result;
      }
    } catch (error) {
      console.error("❌ OpenAI extraction failed:", error);
    }
  }

  // 3. If still no results, try direct investor lookup
  if (openaiApiKey && knownInvestors) {
    try {
      result = await tryInvestorLookup(companyName, knownInvestors, openaiApiKey);
      if (result !== "N/A") {
        console.log("✅ Successfully found investors through direct lookup");
        return result;
      }
    } catch (error) {
      console.error("❌ Investor lookup failed:", error);
    }
  }

  return "N/A";
}

async function tryGroqExtraction(
  text: string,
  companyName: string,
  knownInvestors: string,
  apiKey: string
): Promise<string> {
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

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
      Authorization: `Bearer ${apiKey}`,
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
    if (response.status === 429) {
      throw new Error("Rate limit");
    }
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || "N/A";

    if (
      result.toLowerCase().includes("n/a") ||
      result.toLowerCase().includes("no individual") ||
      result.toLowerCase().includes("not found") ||
    !result.includes("(") ||
      result.trim().length < 5
    ) {
      return "N/A";
    }

    return result.trim();
}

async function tryOpenAIExtraction(
  text: string,
  companyName: string,
  knownInvestors: string,
  apiKey: string
): Promise<string> {
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
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
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const result = data.choices[0]?.message?.content || "N/A";

  if (
    result.toLowerCase().includes("n/a") ||
    result.toLowerCase().includes("no individual") ||
    result.toLowerCase().includes("not found") ||
    !result.includes("(") ||
    result.trim().length < 5
  ) {
    return "N/A";
  }

  return result.trim();
}

async function tryInvestorLookup(
  companyName: string,
  knownInvestors: string,
  apiKey: string
): Promise<string> {
  const prompt = `Find the names of individual investors or investment firm representatives for ${companyName}.

Company: ${companyName}
Known Investment Firms/Investors: ${knownInvestors}
Date: ${new Date().getFullYear()}

Task:
1. Based on the known investors/firms provided, identify specific individuals who are likely to be involved
2. Focus on partners, managing directors, or key decision-makers at the mentioned firms
3. Use your knowledge of the venture capital industry
4. If multiple people from the same firm, prioritize the most senior/relevant ones

Format your response as: "Full Name (Firm Name)" with multiple names separated by commas
Example: "John Smith (Acme Ventures), Jane Doe (XYZ Capital)"

Return ONLY the formatted names, or "N/A" if no confident matches:`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert in venture capital and startup investments. Return only properly formatted investor names or 'N/A'."
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
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const result = data.choices[0]?.message?.content || "N/A";

  if (
    result.toLowerCase().includes("n/a") ||
    result.toLowerCase().includes("no individual") ||
    result.toLowerCase().includes("not found") ||
    !result.includes("(") ||
    result.trim().length < 5
  ) {
    return "N/A";
  }

  return result.trim();
}

async function extractAmountWithLLM(content: string, companyName: string): Promise<string> {
  const groqApiKey = Deno.env.get("GROQ_API_KEY");
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  
  if (!groqApiKey && !openaiApiKey) {
    console.error("❌ Neither GROQ_API_KEY nor OPENAI_API_KEY configured");
    return "N/A";
  }

  const prompt = `Extract the funding amount from this press release about ${companyName}.
  
CONTENT:
${content}

TASK:
1. Find the specific funding amount mentioned
2. Include the currency symbol/code (e.g., $, €, £)
3. Return in format like "$100 million" or "€50M"
4. If multiple amounts found, return the main funding round amount
5. If no clear amount found, return "N/A"

FORMAT:
Return ONLY the amount, nothing else.`;

  // Try Groq first if available
  if (groqApiKey) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
          "Authorization": `Bearer ${groqApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "mixtral-8x7b-32768",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 50
        })
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.log("⚠️ Groq API rate limit hit, falling back to OpenAI");
          throw new Error("Rate limit");
        }
        throw new Error(`Groq API error: ${response.status}`);
      }

      const data = await response.json();
      const amount = data.choices[0].message.content.trim();
      return amount === "N/A" ? "N/A" : amount;
    } catch (error) {
      // If it's not a rate limit error and we don't have OpenAI as fallback, return N/A
      if (error.message !== "Rate limit" || !openaiApiKey) {
        console.error("❌ Error extracting amount:", error instanceof Error ? error.message : 'Unknown error');
        return "N/A";
      }
    }
  }

  // OpenAI fallback
  if (openaiApiKey) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
          model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
              content: "You are a precise extractor of funding amounts from press releases. Return only the amount or 'N/A'."
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
        throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
      const amount = data.choices[0].message.content.trim();
      return amount === "N/A" ? "N/A" : amount;
    } catch (error) {
      console.error("❌ Error extracting amount with OpenAI:", error instanceof Error ? error.message : 'Unknown error');
      return "N/A";
    }
  }

  return "N/A";
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

async function tryAlternativeSearchQueries(record: FundraiseData): Promise<string[]> {
  const serpApiKey = Deno.env.get("SERP_API_KEY");
  if (!serpApiKey) return [];

  // Alternative search queries to try
  const queries = [
    `${record.company_name} announces ${record.amount_raised} funding`,
    `${record.company_name} secures investment ${record.investors || ''}`,
    `${record.company_name} investment news ${record.date_raised}`,
    `${record.company_name} financing round announcement`,
    `${record.company_name} raises capital press release`
  ];

  console.log("\n🔄 Trying alternative search queries...");
  
  const allUrls: AnalyzedUrl[] = [];
  
  for (const query of queries) {
    try {
      console.log(`\n🔍 Trying query: "${query}"`);
      
      const response = await fetch(
        `https://serpapi.com/search.json?` + new URLSearchParams({
          q: query,
          api_key: serpApiKey,
          hl: "en",
          gl: "us",
          num: "5"
        })
      );

      if (!response.ok) continue;

      const data = await response.json();
      const results = data.organic_results || [];
      
      for (const result of results) {
        const url = result.link;
        const content = await fetchUrlContent(url);
        
        if (!content) continue;
        
        // Check for company name and funding keywords
        const companyNameLower = record.company_name.toLowerCase();
        const contentLower = content.toLowerCase();
        
        if (!contentLower.includes(companyNameLower)) continue;
        
        const foundKeywords = fundingKeywords.filter(keyword => 
          contentLower.includes(keyword.toLowerCase())
        );

        if (foundKeywords.length >= 2) { // More lenient keyword requirement for fallback
          allUrls.push({
            url,
            keywordCount: foundKeywords.length,
            keywords: foundKeywords
          });
        }
      }
    } catch (error) {
      console.log(`  ⚠️ Error with query "${query}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      continue;
    }
  }

  // Remove duplicates and sort by keyword count
  const uniqueUrls = Array.from(new Set(allUrls.map(item => item.url)))
    .map(url => allUrls.find(item => item.url === url)!)
    .sort((a, b) => b.keywordCount - a.keywordCount)
    .map(item => item.url);

  console.log(`\n📊 Found ${uniqueUrls.length} additional URLs from alternative queries`);
  return uniqueUrls;
}

async function tryNewsAPIs(record: FundraiseData): Promise<string[]> {
  console.log("\n📰 Trying news API sources...");
  
  // This is where you could integrate with other news APIs
  // For now, we'll use a simple web search with news-specific terms
  const serpApiKey = Deno.env.get("SERP_API_KEY");
  if (!serpApiKey) return [];

  try {
    const query = `${record.company_name} funding news site:techcrunch.com OR site:bloomberg.com OR site:reuters.com OR site:businesswire.com OR site:prnewswire.com`;
    
    const response = await fetch(
      `https://serpapi.com/search.json?` + new URLSearchParams({
        q: query,
        api_key: serpApiKey,
        hl: "en",
        gl: "us",
        num: "5"
      })
    );

    if (!response.ok) return [];

    const data = await response.json();
    return (data.organic_results || [])
      .map((result: any) => result.link)
      .filter((url: string) => url);
  } catch (error) {
    console.log("  ⚠️ News API search failed");
    return [];
  }
}

// Common keywords to look for in content
const fundingKeywords = [
  'raised',
  'funding',
  'investment',
  'investors',
  'funded',
  'fundraised'
];
