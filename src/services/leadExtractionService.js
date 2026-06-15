const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const db = require('../config/database');

class LeadExtractionService {
  /**
   * Extract leads using Google Custom Search API
   */
  async searchGoogle(query, numResults = 10) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;

    if (!apiKey || !cx) {
      logger.warn('Google API credentials not configured, using fallback extraction');
      return this.fallbackSearch(query, numResults);
    }

    const leads = [];
    const pages = Math.ceil(numResults / 10);

    for (let i = 0; i < pages; i++) {
      try {
        const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
          params: {
            key: apiKey,
            cx: cx,
            q: query,
            start: i * 10 + 1,
            num: 10
          }
        });

        if (response.data.items) {
          for (const item of response.data.items) {
            leads.push({
              company_name: item.title,
              website: item.link,
              description: item.snippet,
              source: 'google_search'
            });
          }
        }
      } catch (err) {
        logger.error(`Google search error (page ${i}):`, err.message);
      }

      // Rate limiting
      await this.delay(1000);
    }

    return leads.slice(0, numResults);
  }

  /**
   * Fallback search using web scraping (for when Google API is not available)
   * Uses DuckDuckGo Lite endpoint with POST request (reliable, no API key needed)
   */
  async fallbackSearch(query, numResults = 10) {
    let leads = await this.duckDuckGoLiteSearch(query, numResults);

    // If DDG Lite returns nothing, try the HTML endpoint as secondary
    if (leads.length === 0) {
      leads = await this.duckDuckGoHtmlSearch(query, numResults);
    }

    return leads.slice(0, numResults);
  }

  /**
   * DuckDuckGo Lite search (POST request)
   */
  async duckDuckGoLiteSearch(query, numResults = 10) {
    const leads = [];
    const userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    ];

    try {
      const params = new URLSearchParams();
      params.append('q', query);

      const response = await axios.post('https://lite.duckduckgo.com/lite/', params.toString(), {
        headers: {
          'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://lite.duckduckgo.com/'
        },
        timeout: 15000
      });

      const $ = cheerio.load(response.data);
      const snippets = [];
      $('.result-snippet').each((i, el) => {
        snippets.push($(el).text().trim());
      });

      let idx = 0;
      $('a.result-link').each((i, el) => {
        if (leads.length >= numResults) return false;

        const title = $(el).text().trim();
        const url = $(el).attr('href');

        if (title && url && url.startsWith('http')) {
          leads.push({
            company_name: title,
            website: url,
            description: snippets[idx] || '',
            source: 'duckduckgo'
          });
          idx++;
        }
      });
    } catch (err) {
      logger.error('DuckDuckGo Lite search error:', err.message);
    }

    return leads;
  }

  /**
   * DuckDuckGo HTML search (secondary fallback, POST request)
   */
  async duckDuckGoHtmlSearch(query, numResults = 10) {
    const leads = [];

    try {
      const params = new URLSearchParams();
      params.append('q', query);

      const response = await axios.post('https://html.duckduckgo.com/html/', params.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://html.duckduckgo.com/'
        },
        timeout: 15000
      });

      const $ = cheerio.load(response.data);
      $('.result__body').each((i, el) => {
        if (leads.length >= numResults) return false;

        const title = $(el).find('.result__a').text().trim();
        let url = $(el).find('.result__a').attr('href') || '';
        const snippet = $(el).find('.result__snippet').text().trim();

        // DDG sometimes wraps the real URL in a redirect param
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          url = decodeURIComponent(uddgMatch[1]);
        }

        if (title && url && url.startsWith('http')) {
          leads.push({
            company_name: title,
            website: url,
            description: snippet,
            source: 'duckduckgo_html'
          });
        }
      });
    } catch (err) {
      logger.error('DuckDuckGo HTML search error:', err.message);
    }

    return leads;
  }

  /**
   * Extract leads from business directories
   */
  async searchDirectories(industry, location, numResults = 10) {
    const queries = [
      `${industry} companies ${location} email contact`,
      `${industry} businesses ${location} directory`,
      `small ${industry} companies ${location} that need website`,
      `${industry} startups ${location}`
    ];

    let allLeads = [];
    for (const query of queries) {
      const results = await this.searchGoogle(query, Math.ceil(numResults / queries.length));
      allLeads = allLeads.concat(results);
      await this.delay(2000);
    }

    return allLeads.slice(0, numResults);
  }

  /**
   * Check website quality/status
   */
  async checkWebsite(url) {
    const result = {
      exists: false,
      status: 'unknown',
      score: 0,
      issues: []
    };

    if (!url || url === 'N/A') {
      result.status = 'no_website';
      result.score = 0;
      result.issues.push('No website found');
      return result;
    }

    try {
      const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
      const response = await axios.get(normalizedUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        maxRedirects: 5
      });

      result.exists = true;
      const $ = cheerio.load(response.data);

      // Check for basic quality indicators
      let score = 100;

      // Check if mobile responsive (viewport meta)
      if (!$('meta[name="viewport"]').length) {
        score -= 20;
        result.issues.push('Not mobile responsive');
      }

      // Check for SSL (already https if we got here)
      if (!normalizedUrl.startsWith('https')) {
        score -= 15;
        result.issues.push('No SSL certificate');
      }

      // Check for modern elements
      if (!$('script[src*="react"]').length && !$('script[src*="vue"]').length && !$('script[src*="angular"]').length) {
        // Might be using older tech
        if ($('table[width]').length > 2) {
          score -= 25;
          result.issues.push('Uses outdated table-based layout');
        }
      }

      // Check for basic SEO
      if (!$('meta[name="description"]').length) {
        score -= 10;
        result.issues.push('Missing meta description');
      }
      if (!$('title').text().trim()) {
        score -= 10;
        result.issues.push('Missing page title');
      }

      // Check page load (based on content size)
      const contentLength = response.data.length;
      if (contentLength < 1000) {
        score -= 20;
        result.issues.push('Very minimal content');
      }

      // Check for contact/chat features
      if (!response.data.includes('chat') && !response.data.includes('whatsapp') && !response.data.includes('intercom')) {
        result.issues.push('No chatbot or live chat');
      }

      result.score = Math.max(0, score);
      result.status = score >= 70 ? 'good' : score >= 40 ? 'poor' : 'very_poor';

    } catch (err) {
      if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        result.status = 'down';
        result.score = 0;
        result.issues.push('Website is down or unreachable');
      } else if (err.response && err.response.status >= 400) {
        result.status = 'error';
        result.score = 10;
        result.issues.push(`Website returns error ${err.response.status}`);
      } else {
        result.status = 'timeout';
        result.score = 20;
        result.issues.push('Website is very slow');
      }
    }

    return result;
  }

  /**
   * Extract contact information from a website
   */
  async extractContactInfo(url) {
    const contact = {
      emails: [],
      phones: [],
      name: null
    };

    try {
      const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
      const response = await axios.get(normalizedUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const html = response.data;

      // Extract emails
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = html.match(emailRegex) || [];
      contact.emails = [...new Set(emails)].filter(e =>
        !e.includes('example.com') &&
        !e.includes('wixpress') &&
        !e.includes('sentry')
      ).slice(0, 5);

      // Extract phone numbers
      const phoneRegex = /[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}/g;
      const phones = html.match(phoneRegex) || [];
      contact.phones = [...new Set(phones)].filter(p => p.length >= 8).slice(0, 3);

      // Try to extract company/person name from title
      const $ = cheerio.load(html);
      contact.name = $('title').text().trim().split('|')[0].split('-')[0].trim();

    } catch (err) {
      logger.debug(`Contact extraction failed for ${url}: ${err.message}`);
    }

    return contact;
  }

  /**
   * Full lead extraction pipeline for a campaign
   */
  async extractLeads(campaign) {
    const { target_industry, target_region, target_volume } = campaign;

    logger.info(`Starting lead extraction: ${target_industry} in ${target_region}, target: ${target_volume}`);

    const leads = await this.searchDirectories(target_industry, target_region, target_volume);

    const processedLeads = [];
    for (const lead of leads) {
      // Check website
      const websiteCheck = await this.checkWebsite(lead.website);

      // Extract contact info
      let contactInfo = { emails: [], phones: [], name: null };
      if (lead.website && websiteCheck.exists) {
        contactInfo = await this.extractContactInfo(lead.website);
      }

      processedLeads.push({
        ...lead,
        contact_name: contactInfo.name || lead.company_name,
        contact_email: contactInfo.emails[0] || null,
        phone: contactInfo.phones[0] || null,
        website_status: websiteCheck.status,
        website_score: websiteCheck.score,
        website_issues: websiteCheck.issues
      });

      // Rate limiting between checks
      await this.delay(2000);
    }

    return processedLeads;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new LeadExtractionService();
