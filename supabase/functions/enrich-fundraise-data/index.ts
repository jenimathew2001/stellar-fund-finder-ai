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

const getUrls = async (record_arg: FundraiseData): Promise<string[]> => {
  const record = { ...record_arg };

  if (record.investors === "Not specified") record.investors = "";

  // Step 0 :try google search
  const urls_google = await searchFundingPressReleasesGoogle(record);

  if (urls_google.urls.length >= 3) return urls_google.urls;

  // Step 1: Get initial URLs from GPT-4
  console.log("\n🤖 STEP 1: Getting URLs from GPT-4");
  console.log("----------------------------------------");
  const gptResult = await tryGPT4Initial(record);
  console.log(`Found ${gptResult.urls.length} URLs from GPT-4`);
  // Step 2: Validate each URL from GPT-4
  console.log("\n🔍 STEP 2: Validating GPT-4 URLs");
  console.log("----------------------------------------");
  const validUrls: string[] = [];

  for (const url of gptResult.urls) {
    console.log(`\nChecking URL: ${url}`);
    const isValid = await validateSingleUrl(url, record.company_name);
    if (isValid) {
      console.log("✅ URL is valid and relevant");
      validUrls.push(url);
    } else {
      console.log("❌ URL is invalid or irrelevant");
    }
  }
  console.log(
    `\nValidation summary: ${validUrls.length}/${gptResult.urls.length} URLs valid`
  );

  let finalUrls = validUrls;

  // Step 3: If we don't have 3 valid URLs, try SERP
  if (validUrls.length < 3) {
    console.log("\n🔎 STEP 3: Getting additional URLs from SERP");
    console.log("----------------------------------------");
    const neededUrls = 3 - validUrls.length;
    console.log(`Need ${neededUrls} more valid URLs`);

    const serpUrls: string[] = [];
    let retryCount = 0;
    const maxRetries = 3;

    while (serpUrls.length < neededUrls && retryCount < maxRetries) {
      try {
        const serpResult = await trySerpForRemaining(
          record,
          neededUrls * 2,
          validUrls
        );
        console.log(
          `Found ${serpResult.urls.length} URLs from SERP, validating...`
        );

        // Validate each SERP URL
        for (const url of serpResult.urls) {
          if (serpUrls.length >= neededUrls) break;

          console.log(`\nChecking SERP URL: ${url}`);
          const isValid = await validateSingleUrl(url, record.company_name);
          if (isValid && !validUrls.includes(url) && !serpUrls.includes(url)) {
            console.log("✅ SERP URL is valid and relevant");
            serpUrls.push(url);
          } else {
            console.log("❌ SERP URL is invalid, irrelevant, or duplicate");
          }
        }

        if (serpUrls.length >= neededUrls) break;
        retryCount++;

        if (retryCount < maxRetries) {
          console.log(
            `\nNeed ${
              neededUrls - serpUrls.length
            } more URLs, retrying SERP (attempt ${
              retryCount + 1
            }/${maxRetries})...`
          );
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s between retries
        }
      } catch (error) {
        console.error(`SERP attempt ${retryCount + 1} failed:`, error);
        retryCount++;
        if (retryCount < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    finalUrls = [...validUrls, ...serpUrls];
    console.log(
      `\nSERP summary: Found ${serpUrls.length} additional valid URLs`
    );

    return finalUrls;
  }
  return [];
};

/**
 * Main function to enrich fundraise data. The process follows these steps:
 * 1. Try GPT-4 first to get URLs, amount, and investor info
 * 2. Validate GPT-4 provided URLs by checking content
 * 3. If needed, use SERP to find additional URLs
 * 4. Extract and verify information from valid URLs
 * 5. Final GPT-4 attempt if any information is missing
 */
async function enrichRecordData(
  record: FundraiseData
): Promise<Partial<FundraiseData>> {
  console.log(`\n📋 Processing: ${record.company_name}`);
  console.log("----------------------------------------");

  const finalUrls = await getUrls(record);

  // Step 4: Extract information from valid URLs
  if (finalUrls.length === 3) {
    console.log("\n📑 STEP 4: Extracting information from URLs");
    console.log("----------------------------------------");
    console.log("Processing URLs:");
    finalUrls.forEach((url, index) => console.log(`${index + 1}. ${url}`));

    const extractedData = await extractDataFromUrls(finalUrls, record);

    console.log("\nExtraction Results:");
    console.log(`Amount Raised: ${extractedData.amount_raised}`);
    console.log(`Investor Contacts: ${extractedData.investor_contacts}`);

    return {
      press_url_1: finalUrls[0],
      press_url_2: finalUrls[1],
      press_url_3: finalUrls[2],
      investor_contacts: extractedData.investor_contacts,
      amount_raised: extractedData.amount_raised,
    };
  }

  // If we couldn't get 3 valid URLs
  console.log("\n⚠️ Could not find 3 valid URLs");
  console.log("----------------------------------------");
  console.log(`Total valid URLs found: ${finalUrls.length}`);

  return {
    press_url_1: finalUrls[0] || "N/A",
    press_url_2: finalUrls[1] || "N/A",
    press_url_3: finalUrls[2] || "N/A",
    investor_contacts: "N/A",
    amount_raised: "N/A",
  };
}

interface PressSearchOptions {
  companyName: string;
  investors?: string;
}

interface SearchResult {
  urls: string[];
}

const getPromptForGoogleSearch = (
  company_name: string,
  investors?: string
): string => {
  const excludeFiles =
    "-filetype:pdf -filetype:doc -filetype:docx -filetype:xls -filetype:ppt -filetype:txt -filetype:rtf";

  // const topSources = [
  //   "crunchbase.com",
  //   "techcrunch.com",
  //   "businesswire.com",
  //   "prnewswire.com",
  //   "reuters.com",
  //   "globenewswire.com",
  //   "venturebeat.com",
  //   "forbes.com",
  // ].join(" OR ");

  const baseQuery = `"${company_name}" funding round ${
    investors ? `${investors}` : ""
  } press release`;

  return `${baseQuery} ${excludeFiles}`.trim();
};

export async function searchFundingPressReleasesGoogle(
  record: FundraiseData
): Promise<SearchResult> {
  const API_KEY = Deno.env.get("GOOGLE_API");
  const CX = Deno.env.get("GOOGLE_CX");

  const query = getPromptForGoogleSearch(record.company_name, record.investors);
  const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${CX}&q=${encodeURIComponent(
    query
  )}&num=5`;

  console.log("Google api trying : ", query);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const data = await response.json();

    const urls: string[] =
      data.items?.map((item: any) => item.link).slice(0, 3) || [];

    console.log("Found urls from google api ", urls);
    return { urls };
  } catch (error) {
    console.error("Error fetching press releases:", error);
    return { urls: [] };
  }
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

  const prompt = `Find press release URLs for ${
    record.company_name
  }'s funding round.

Company: ${record.company_name}
Date: ${record.date_raised || "Recent"}
Known Investors: ${record.investors || "Unknown"}

Task:
Find 3 most relevant press release URLs about this funding round.
- Focus on official press releases and major news sites
- Ensure URLs are specific to this company and this funding round
- Prioritize: businesswire.com, prnewswire.com, globenewswire.com, techcrunch.com, reuters.com

Return in JSON format:
{
  "urls": ["url1", "url2", "url3"]
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
            content:
              "You are an expert in finding accurate press releases about startup funding rounds.",
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
    const result = JSON.parse(data.choices[0]?.message?.content || "{}");

    return {
      urls: result.urls || [],
      investor_contacts: "N/A", // We'll get this from URL content later
      amount_raised: "N/A", // We'll get this from URL content later
    };
  } catch (error) {
    console.error("❌ GPT-4 URL search failed:", error);
    return { urls: [], investor_contacts: "N/A", amount_raised: "N/A" };
  }
}

/**
 * Validates a single URL by checking its content
 */
async function validateSingleUrl(
  url: string,
  companyName: string
): Promise<boolean> {
  try {
    const content = await fetchUrlContent(url);
    if (!content) return false;

    const companyNameLower = companyName.toLowerCase();
    const contentLower = content.toLowerCase();

    // Must contain company name
    if (!contentLower.includes(companyNameLower)) {
      console.log("Company name not found in content");
      return false;
    }

    // Must contain funding keywords
    const fundingKeywords = [
      "funding",
      "investment",
      "raises",
      "raised",
      "round",
      "capital",
    ];
    const foundKeywords = fundingKeywords.filter((keyword) =>
      contentLower.includes(keyword.toLowerCase())
    );

    // Calculate relevance score
    let score = foundKeywords.length;
    if (url.includes("press-release") || url.includes("news")) score += 1;
    if (/businesswire\.com|prnewswire\.com|globenewswire\.com/.test(url))
      score += 2;
    if (/techcrunch\.com|reuters\.com|bloomberg\.com/.test(url)) score += 1;

    const isValid = score >= 2;
    if (!isValid) {
      console.log(`Not enough relevance indicators (score: ${score})`);
    }
    return isValid;
  } catch (error) {
    console.log(
      "Error fetching or processing URL:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return false;
  }
}

/**
 * Uses SERP API to find additional URLs when GPT-4 results are insufficient.
 * Focuses on press releases and tech news sites.
 */
async function trySerpForRemaining(
  record: FundraiseData,
  count: number,
  existingUrls: string[]
): Promise<{ urls: string[] }> {
  const serpApiKey = Deno.env.get("SERP_API_KEY");
  if (!serpApiKey) {
    throw new Error("SERP_API_KEY not configured");
  }

  // Try different search queries for better results
  const searchQueries = [
    `"${record.company_name}" funding press release ${record.date_raised} site:businesswire.com OR site:prnewswire.com OR site:globenewswire.com`,
    `"${record.company_name}" raises funding ${record.date_raised}`,
    `"${record.company_name}" investment announcement ${record.date_raised} site:techcrunch.com OR site:reuters.com`,
  ];

  for (const query of searchQueries) {
    console.log(`Trying SERP query: "${query}"`);

    const response = await fetch(
      `https://serpapi.com/search.json?` +
        new URLSearchParams({
          q: query,
          api_key: serpApiKey,
          hl: "en",
          gl: "us",
          num: count.toString(),
        })
    );

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("SERP API rate limit reached");
      }
      throw new Error(`SERP API error: ${response.status}`);
    }

    const data = await response.json();
    const results = data.organic_results || [];

    // Filter out existing URLs
    const newUrls = results
      .map((result: any) => result.link)
      .filter((url: string) => !existingUrls.includes(url));

    if (newUrls.length > 0) {
      return { urls: newUrls };
    }
  }

  return { urls: [] };
}

/**
 * Update extractDataFromUrls to be more concise
 */
async function extractDataFromUrls(
  urls: string[],
  record: FundraiseData
): Promise<ExtractedData> {
  console.log("\nAttempting data extraction...");

  // First try with Groq
  try {
    console.log("Trying extraction with Groq...");
    const groqResult = await extractWithGroq(urls, record);
    if (
      groqResult.investor_contacts !== "N/A" &&
      groqResult.amount_raised !== "N/A"
    ) {
      console.log("✅ Groq extraction successful");
      return groqResult;
    }
    console.log("⚠️ Groq extraction incomplete, falling back to GPT-4");
  } catch (error) {
    console.log("⚠️ Groq extraction failed, falling back to GPT-4");
  }

  // Fallback to GPT-4
  console.log("Trying extraction with GPT-4...");
  const gptResult = await extractWithGPT4(urls, record);
  console.log(
    gptResult.investor_contacts === "N/A" || gptResult.amount_raised === "N/A"
      ? "⚠️ GPT-4 extraction incomplete"
      : "✅ GPT-4 extraction successful"
  );
  return gptResult;
}
const createPromptForGroq = (
  combinedContent: string,
  record: FundraiseData
) => {
  const prompt = `Extract funding information from these articles about ${
    record.company_name
  }.

Company: ${record.company_name}
Known Investors: ${record.investors || "Unknown"}

Content:
${combinedContent}

Extract:
1. Individual investors and their roles (format: "Name (Role, Firm)")
2. funding amount with currency

if you dont find the data in the content search the internet for it

Return in JSON format in a single line and not extra text other than the json :
{
  "investor_contacts": "Name1 (Role, Firm1), Name2 (Role, Firm2)",
  "amount_raised": "$X million"
}
  do not send 0 million as its wrong instead send N/A as response in amount raised; 
  if data is not found return {}`;

  return prompt;
};
const askGroq = async (
  prompt: string
): Promise<{
  investor_contacts?: string;
  amount_raised?: string;
}> => {
  const groqApiKey = Deno.env.get("GROQ_API_KEY");
  if (!groqApiKey) throw new Error("No Groq API key");

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
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
            content:
              "You are an expert at extracting precise funding information from press releases and only response in json.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    }
  );

  if (!response.ok) {
    console.log(response.status, " groq response", await response.json());
    if (response.status === 429) throw new Error("Rate limit");
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data = await response.json();
  console.log("data", data);
  try {
    console.log("ai response ", data.choices[0]?.message?.content);
    const result = JSON.parse(data.choices[0]?.message?.content || "{}");
    return {
      investor_contacts: result.investor_contacts || "",
      amount_raised: result.amount_raised || "",
    };
  } catch (e) {
    //
  }

  return {};
};

async function extractWithGroq(
  urls: string[],
  record: FundraiseData
): Promise<ExtractedData> {
  for (const url of urls) {
    console.log("trying with : ", url);
    try {
      const content = await fetchUrlContent(url);
      console.log("Got content from ", content);
      if (content) {
        const prompt = await createPromptForGroq(content, record);
        const response = await askGroq(prompt);
        if (response.amount_raised && response.investor_contacts)
          return {
            amount_raised: response.amount_raised || "N/A",
            investor_contacts: response.investor_contacts || "N/A",
            urls: urls,
          };
      }
    } catch (error) {
      continue;
    }
  }

  throw new Error("No content could be extracted from URLs");
}
const askOpenAi = async (prompt: string) => {
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) {
    return { investor_contacts: "N/A", amount_raised: "N/A" };
  }
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
            content:
              "You are an expert at extracting precise funding information from press releases. and only response in json",
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
    const result = JSON.parse(data.choices[0]?.message?.content || "{}");

    return {
      investor_contacts: result.investor_contacts || "N/A",
      amount_raised: result.amount_raised || "N/A",
    };
  } catch (error) {
    console.error("❌ GPT-4 extraction failed:", error);
    return { investor_contacts: "N/A", amount_raised: "N/A" };
  }
};

async function extractWithGPT4(
  urls: string[],
  record: FundraiseData
): Promise<ExtractedData> {
  for (const url of urls) {
    console.log("trying with : ", url);
    try {
      const content = await fetchUrlContent(url);
      console.log("Got content from ", content);
      if (content) {
        const prompt = await createPromptForGroq(content, record);
        const response = await askOpenAi(prompt);
        if (response.amount_raised && response.investor_contacts)
          return {
            amount_raised: response.amount_raised || "N/A",
            investor_contacts: response.investor_contacts || "N/A",
            urls: urls,
          };
      }
    } catch (error) {
      continue;
    }
  }

  return { urls, investor_contacts: "N/A", amount_raised: "N/A" };
}

export async function fetchUrlContent(url: string): Promise<string> {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ];

  const usedIndexes = new Set<number>();

  for (let attempt = 1; attempt <= 3; attempt++) {
    let index: number;
    do {
      index = Math.floor(Math.random() * userAgents.length);
    } while (usedIndexes.has(index));
    usedIndexes.add(index);

    const userAgent = userAgents[index];
    console.log(`🔄 Attempt ${attempt}/3 for ${url}`);
    console.log(`🕵️ Using User-Agent: ${userAgent.slice(0, 60)}...`);

    try {
      const response = await fetch(url, {
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "max-age=0",
          priority: "u=0, i",
          "sec-ch-ua":
            '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-user": "?1",
          "upgrade-insecure-requests": "1",
          "User-Agent": userAgent,
        },
        referrerPolicy: "strict-origin-when-cross-origin",
        body: null,
        redirect: "follow",
        method: "GET",
        mode: "cors",
        credentials: "include",
      });

      if (!response.ok) {
        console.log(
          `❌ Failed [${response.status}] for ${url}`,
          await response.text()
        );
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const text = extractTextFromHTML(html);

      if (text.length > 200) {
        console.log(`✅ Success on attempt ${attempt}`);
        return text;
      } else {
        throw Error(`⚠️ Content too short (length: ${text.length})`);
      }
    } catch (err) {
      console.log(`🚫 Attempt ${attempt} error: ${(err as Error).message}`);
      if (attempt < 3) await new Promise((res) => setTimeout(res, 1000));
    }
  }

  console.log(`❎ All 3 attempts failed for ${url}`);
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
      result = await tryGroqExtraction(
        text,
        companyName,
        knownInvestors,
        groqApiKey
      );
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
      result = await tryOpenAIExtraction(
        text,
        companyName,
        knownInvestors,
        openaiApiKey
      );
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
      result = await tryInvestorLookup(
        companyName,
        knownInvestors,
        openaiApiKey
      );
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

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
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
            content:
              "You are a precise extractor of investor information from press releases. Return only properly formatted investor names or 'N/A'.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
    }
  );

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
          content:
            "You are a precise extractor of investor information from press releases. Return only properly formatted investor names or 'N/A'.",
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
          content:
            "You are an expert in venture capital and startup investments. Return only properly formatted investor names or 'N/A'.",
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

async function extractAmountWithLLM(
  content: string,
  companyName: string
): Promise<string> {
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
      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "mixtral-8x7b-32768",
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
            temperature: 0.1,
            max_tokens: 50,
          }),
        }
      );

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
        console.error(
          "❌ Error extracting amount:",
          error instanceof Error ? error.message : "Unknown error"
        );
        return "N/A";
      }
    }
  }

  // OpenAI fallback
  if (openaiApiKey) {
    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
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
                content:
                  "You are a precise extractor of funding amounts from press releases. Return only the amount or 'N/A'.",
              },
              {
                role: "user",
                content: prompt,
              },
            ],
            temperature: 0.1,
            max_tokens: 50,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const amount = data.choices[0].message.content.trim();
      return amount === "N/A" ? "N/A" : amount;
    } catch (error) {
      console.error(
        "❌ Error extracting amount with OpenAI:",
        error instanceof Error ? error.message : "Unknown error"
      );
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
            content:
              "You are a research assistant. Find press releases and extract funding information. Return valid JSON only.",
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

async function tryAlternativeSearchQueries(
  record: FundraiseData
): Promise<string[]> {
  const serpApiKey = Deno.env.get("SERP_API_KEY");
  if (!serpApiKey) return [];

  // Alternative search queries to try
  const queries = [
    `${record.company_name} announces ${record.amount_raised} funding`,
    `${record.company_name} secures investment ${record.investors || ""}`,
    `${record.company_name} investment news ${record.date_raised}`,
    `${record.company_name} financing round announcement`,
    `${record.company_name} raises capital press release`,
  ];

  console.log("\n🔄 Trying alternative search queries...");

  const allUrls: AnalyzedUrl[] = [];

  for (const query of queries) {
    try {
      console.log(`\n🔍 Trying query: "${query}"`);

      const response = await fetch(
        `https://serpapi.com/search.json?` +
          new URLSearchParams({
            q: query,
            api_key: serpApiKey,
            hl: "en",
            gl: "us",
            num: "5",
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

        const foundKeywords = fundingKeywords.filter((keyword) =>
          contentLower.includes(keyword.toLowerCase())
        );

        if (foundKeywords.length >= 2) {
          // More lenient keyword requirement for fallback
          allUrls.push({
            url,
            keywordCount: foundKeywords.length,
            keywords: foundKeywords,
          });
        }
      }
    } catch (error) {
      console.log(
        `  ⚠️ Error with query "${query}": ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      continue;
    }
  }

  // Remove duplicates and sort by keyword count
  const uniqueUrls = Array.from(new Set(allUrls.map((item) => item.url)))
    .map((url) => allUrls.find((item) => item.url === url)!)
    .sort((a, b) => b.keywordCount - a.keywordCount)
    .map((item) => item.url);

  console.log(
    `\n📊 Found ${uniqueUrls.length} additional URLs from alternative queries`
  );
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
      `https://serpapi.com/search.json?` +
        new URLSearchParams({
          q: query,
          api_key: serpApiKey,
          hl: "en",
          gl: "us",
          num: "5",
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
  "raised",
  "funding",
  "investment",
  "investors",
  "funded",
  "fundraised",
];
