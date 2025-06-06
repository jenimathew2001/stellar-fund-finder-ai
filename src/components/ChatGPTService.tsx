
interface ChatGPTResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class ChatGPTService {
  private apiKey: string;
  private baseURL = 'https://api.openai.com/v1/chat/completions';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async findPressReleases(companyName: string, dateRaised: string, amountRaised: string, investors: string): Promise<string[]> {
    const prompt = `Find 3 most relevant press release URLs about ${companyName}'s fundraise in ${dateRaised} for ${amountRaised} from ${investors}. 

Please search for and return ONLY the URLs of actual press releases, news articles, or official announcements about this specific fundraising round. Return the URLs in this exact format:
URL1: [url]
URL2: [url]
URL3: [url]

If you cannot find 3 URLs, return as many as you can find, but ensure they are real, working URLs.`;

    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are a research assistant that finds press releases and news articles about startup fundraising. Return only real, valid URLs.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const data: ChatGPTResponse = await response.json();
      const content = data.choices[0]?.message?.content || '';
      
      // Extract URLs from the response
      const urlMatches = content.match(/URL\d+:\s*(https?:\/\/[^\s\n]+)/g) || [];
      const urls = urlMatches.map(match => match.replace(/URL\d+:\s*/, '').trim());
      
      return urls.slice(0, 3); // Ensure we only return max 3 URLs
    } catch (error) {
      console.error('Error finding press releases:', error);
      return [];
    }
  }

  async extractInvestorContacts(pressUrls: string[]): Promise<string> {
    const prompt = `Given these press release URLs about a startup fundraising round:
${pressUrls.join('\n')}

Please extract the names of people involved from the investor side (VCs, Angels, Firm Partners, Managing Directors, etc.) mentioned in these articles. 

Return the names as a comma-separated list in this format:
Name (Company), Name (Company), Name (Company)

If you cannot access the URLs, please indicate that the URLs need to be checked manually.`;

    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are a research assistant that extracts investor contact information from press releases and news articles.'
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
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const data: ChatGPTResponse = await response.json();
      return data.choices[0]?.message?.content || 'Unable to extract contacts';
    } catch (error) {
      console.error('Error extracting investor contacts:', error);
      return 'Error extracting contacts';
    }
  }
}
