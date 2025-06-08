
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

    // Search for press releases with multiple strategies
    const pressData = await searchAndExtractPressData(
      record.company_name,
      record.investors,
      record.date_raised
    );

    console.log("📰 Final press data:", pressData);

    const updateData: Partial<FundraiseData> = {
      press_url_1: pressData.urls[0] || "N/A",
      press_url_2: pressData.urls[1] || "N/A", 
      press_url_3: pressData.urls[2] || "N/A",
      investor_contacts: pressData.investorNames || "N/A",
      amount_raised: pressData.amountRaised || record.amount_raised,
      status: "completed",
    };

    console.log("💾 Final update data:", updateData);

    const response: FundraiseData = {
      ...record,
      ...updateData,
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

async function searchAndExtractPressData(
  companyName: string,
  investors: string,
  dateRaised: string
): Promise<{
  urls: string[];
  investorNames: string;
  amountRaised: string;
}> {
  const serpApiKey = Deno.env.get("SERP_API_KEY");
  if (!serpApiKey) {
    console.error("❌ SERP_API_KEY not configured");
    return { urls: [], investorNames: "N/A", amountRaised: "N/A" };
  }

  // Format date for search
  let searchYear = "";
  if (dateRaised) {
    const dateMatch = dateRaised.match(/\d{4}/);
    if (dateMatch) {
      searchYear = dateMatch[0];
    } else if (!isNaN(Number(dateRaised))) {
      const excelDate = new Date((Number(dateRaised) - 25569) * 86400 * 1000);
      searchYear = excelDate.getFullYear().toString();
    }
  }

  // Multiple targeted search strategies for press releases
  const searchQueries = [
    `"${companyName}" "funding" "press release" ${searchYear}`,
    `"${companyName}" "raises" "investment" "announcement" ${searchYear}`,
    `"${companyName}" "series" "funding" "round" ${searchYear}`,
    `"${companyName}" "${investors}" "funding" "press release"`,
    `"${companyName}" "funding" "TechCrunch" OR "VentureBeat" OR "BusinessWire"`,
    `"${companyName}" "investment" "announcement" site:techcrunch.com OR site:venturebeat.com`,
    `"${companyName}" "funding" site:businesswire.com OR site:prnewswire.com`,
  ];

  let allUrls: string[] = [];
  let searchCount = 0;
  const maxSearches = 5;

  for (const query of searchQueries) {
    if (allUrls.length >= 5 || searchCount >= maxSearches) break;
    
    console.log(`🔎 Search ${searchCount + 1}: "${query}"`);
    
    try {
      if (searchCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const response = await fetch(
        `https://serpapi.com/search?q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=10&engine=google&hl=en&gl=us`
      );

      if (!response.ok) {
        if (response.status === 429) {
          console.error("⚠️ Rate limit hit, stopping search");
          break;
        }
        console.error("🚫 SERP API error:", response.status, response.statusText);
        searchCount++;
        continue;
      }

      const data = await response.json();
      const organicResults = data.organic_results || [];
      
      console.log(`📊 Found ${organicResults.length} results for query`);

      const urls = organicResults
        .map((result: any) => result.link)
        .filter((url: string) => url && isPressReleaseUrl(url, companyName))
        .slice(0, 3);

      console.log(`✅ Filtered to ${urls.length} press release URLs:`, urls);
      
      allUrls.push(...urls);
      allUrls = [...new Set(allUrls)]; // Remove duplicates
      searchCount++;

    } catch (error) {
      console.error("💥 Search error:", error);
      searchCount++;
    }
  }

  const finalUrls = allUrls.slice(0, 3);
  console.log(`📋 Final URLs (${finalUrls.length}):`, finalUrls);

  if (finalUrls.length === 0) {
    console.log("❌ No press release URLs found");
    return { urls: [], investorNames: "N/A", amountRaised: "N/A" };
  }

  // Extract content and analyze with LLM
  const extractedData = await extractDataFromUrls(finalUrls, companyName, investors);

  return {
    urls: finalUrls,
    investorNames: extractedData.investorNames,
    amountRaised: extractedData.amountRaised,
  };
}

function isPressReleaseUrl(url: string, companyName: string): boolean {
  const urlLower = url.toLowerCase();
  const companyLower = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");

  // High-priority press release domains
  const pressReleaseDomains = [
    "businesswire.com",
    "prnewswire.com", 
    "globenewswire.com",
    "reuters.com",
    "bloomberg.com",
    "techcrunch.com",
    "venturebeat.com",
    "crunchbase.com",
    "finance.yahoo.com",
    "marketwatch.com",
    "benzinga.com",
    "spacenews.com",
    "spaceflightnow.com"
  ];

  // Check for press release domains
  const hasPressReleaseDomain = pressReleaseDomains.some(domain => urlLower.includes(domain));
  
  // Check for company name in URL
  const hasCompanyName = urlLower.includes(companyLower);
  
  // Check for funding keywords
  const hasFundingKeywords = urlLower.includes("funding") || 
                             urlLower.includes("investment") || 
                             urlLower.includes("raise") || 
                             urlLower.includes("round") ||
                             urlLower.includes("announcement") ||
                             urlLower.includes("press-release");

  // Prioritize press release domains, then company name + funding keywords
  return hasPressReleaseDomain || (hasCompanyName && hasFundingKeywords);
}

async function extractDataFromUrls(
  urls: string[],
  companyName: string,
  investors: string
): Promise<{
  investorNames: string;
  amountRaised: string;
}> {
  let allTexts: string[] = [];

  console.log(`📥 Extracting content from ${urls.length} URLs...`);

  for (const url of urls) {
    console.log(`🌐 Processing: ${url}`);
    
    try {
      const text = await fetchArticleContentAdvanced(url);
      if (text && text.length > 100) {
        allTexts.push(text);
        console.log(`✅ Extracted ${text.length} characters from ${url}`);
      } else {
        console.log(`⚠️ Insufficient content from ${url}`);
      }
    } catch (error) {
      console.error(`❌ Failed to extract from ${url}:`, error);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (allTexts.length === 0) {
    console.log("❌ No content extracted");
    return { investorNames: "N/A", amountRaised: "N/A" };
  }

  const combinedText = allTexts.join("\n\n").slice(0, 15000);
  console.log(`📝 Combined text length: ${combinedText.length} characters`);

  // Extract data using LLM
  const [investorNames, amountRaised] = await Promise.all([
    extractInvestorNamesWithLLM(combinedText, companyName, investors),
    extractAmountRaisedWithLLM(combinedText, companyName),
  ]);

  return { investorNames, amountRaised };
}

async function fetchArticleContentAdvanced(url: string): Promise<string> {
  const blockedDomains = ["facebook.com", "twitter.com", "linkedin.com", "instagram.com"];
  if (blockedDomains.some(domain => url.includes(domain))) {
    console.log(`🚫 Skipping social media: ${url}`);
    return "";
  }

  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ];

  for (let attempt = 0; attempt < userAgents.length; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt + 1} for ${url}`);

      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgents[attempt],
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const text = extractTextFromHTML(html);

      if (text.length > 100) {
        return text;
      }
    } catch (error) {
      console.error(`❌ Attempt ${attempt + 1} failed:`, error);
      if (attempt < userAgents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  return "";
}

function extractTextFromHTML(html: string): string {
  // Multiple extraction strategies
  const strategies = [
    // Strategy 1: Press release specific selectors
    /<div[^>]*class="[^"]*press[^"]*"[^>]*>(.*?)<\/div>/gis,
    /<div[^>]*class="[^"]*release[^"]*"[^>]*>(.*?)<\/div>/gis,
    /<div[^>]*class="[^"]*announcement[^"]*"[^>]*>(.*?)<\/div>/gis,
    // Strategy 2: Article content
    /<article[^>]*>(.*?)<\/article>/gis,
    /<main[^>]*>(.*?)<\/main>/gis,
    // Strategy 3: Content divs
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/gis,
    /<div[^>]*class="[^"]*article[^"]*"[^>]*>(.*?)<\/div>/gis,
    // Strategy 4: Paragraphs
    /<p[^>]*>(.*?)<\/p>/gis,
  ];

  let text = "";
  for (const pattern of strategies) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      text = matches.join(" ");
      if (text.length > 500) break;
    }
  }

  // If no good content found, extract all paragraphs
  if (text.length < 200) {
    const paragraphs = html.match(/<p[^>]*>(.*?)<\/p>/gis);
    if (paragraphs) {
      text = paragraphs.join(" ");
    }
  }

  // Clean HTML and decode entities
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
    .replace(/&apos;/g, "'")
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

  const prompt = `You are a financial analyst extracting investor contact information from a funding announcement about ${companyName}.

TASK: Extract the names of INDIVIDUAL PEOPLE who represent the INVESTORS/VENTURE CAPITAL FIRMS in this funding round.

REQUIREMENTS:
- Extract FULL NAMES of individual people (not just companies)
- Format as: "FirstName LastName (Firm Name)"
- Example output: "Brayton Williams (Boost VC), Nicole Velho (Sie Ventures)"
- Only include people who are partners, managing directors, principals, or investors at VC firms
- Do NOT include company executives, founders, or employees of ${companyName}
- If no individual investor names are found, return "N/A"

Known investor firms mentioned: ${knownInvestors}

ARTICLE TEXT:
${text.slice(0, 8000)}

EXTRACT INVESTOR NAMES (format: "Name (Firm)"):`;

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
            content: "You are a precise financial analyst who extracts investor contact names from press releases. Focus only on individual people from investor firms, formatted as 'Name (Firm)'.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 400,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || "N/A";

    console.log("🤖 LLM Investor Names Result:", result);

    // Clean and validate result
    if (
      result.toLowerCase().includes("n/a") ||
      result.toLowerCase().includes("no individual") ||
      result.toLowerCase().includes("not found") ||
      result.toLowerCase().includes("not mentioned") ||
      result.trim().length < 5
    ) {
      return "N/A";
    }

    // Extract names in the format "Name (Firm)"
    const namePattern = /([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*\(([^)]+)\)/g;
    const matches = [...result.matchAll(namePattern)];
    
    if (matches.length > 0) {
      const formattedNames = matches.map(match => `${match[1]} (${match[2]})`);
      return formattedNames.join(", ");
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

  const prompt = `Extract the funding amount raised by ${companyName} from this press release.

INSTRUCTIONS:
- Look for funding amounts like "$5M", "$10 million", "$2.5B", "€1.2M", etc.
- Return the amount in format like "$5M" or "$10 million"
- If no specific amount is mentioned, return "N/A"
- Look for phrases like "raised", "funding", "investment", "round", "secured"

ARTICLE TEXT:
${text.slice(0, 8000)}

FUNDING AMOUNT:`;

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
            content: "You are a financial analyst who extracts funding amounts from press releases. Be precise and only return the amount.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || "N/A";

    console.log("🤖 LLM Amount Raised Result:", result);

    if (
      result.toLowerCase().includes("n/a") ||
      result.toLowerCase().includes("no amount") ||
      result.toLowerCase().includes("not mentioned") ||
      result.trim().length < 2
    ) {
      return "N/A";
    }

    return result.trim();
  } catch (error) {
    console.error("💥 Error extracting amount raised:", error);
    return "N/A";
  }
}
