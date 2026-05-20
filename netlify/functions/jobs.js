const https = require('https');

const FEED_URL = 'https://recruitingbypaycor.com/career/JobBoardAtom.action?clientId=8a7883d09be7cb01019c10eb04fa0f97';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim();
}

function extractText(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? stripHtml(match[1]).trim() : '';
}

function extractAttr(xml, tag, attr) {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseAtom(xml) {
  const jobs = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const title    = extractText(entry, 'title');
    const link     = extractAttr(entry, 'link', 'href') || extractText(entry, 'link');
    const category = extractAttr(entry, 'category', 'term') || extractAttr(entry, 'category', 'label');
    const summary  = extractText(entry, 'summary');
    const updated  = extractText(entry, 'updated');

    // Try to pull location out of summary text
    const locMatch = summary.match(/(?:Location|City)[:\s–-]+([^\n|<]+)/i);
    const location = locMatch ? locMatch[1].trim() : '';

    if (title) {
      jobs.push({ title, link, category: category || 'General', location, summary: summary.slice(0, 300), updated });
    }
  }

  return jobs;
}

exports.handler = async function () {
  try {
    const xml = await fetchUrl(FEED_URL);
    const jobs = parseAtom(xml);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify(jobs),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
