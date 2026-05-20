const https = require('https');
const http  = require('http');

const CLIENT_ID = '8a7883d09be7cb01019c10eb04fa0f97';
const FEED_URLS = [
  `https://recruitingbypaycor.com/career/JobBoardAtom.action?clientId=${CLIENT_ID}`,
  `http://recruitingbypaycor.com/career/JobBoardAtom.action?clientId=${CLIENT_ID}`,
  `https://recruitingbypaycor.com/career/jobBoardAtom.action?clientId=${CLIENT_ID}`,
];

function fetchUrl(url) {
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/atom+xml, application/xml, text/xml, */*' } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function decode(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '').trim();
}

function getTag(xml, tag) {
  const r = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(r);
  return m ? decode(m[1]) : '';
}

function getAttr(xml, tag, attr) {
  const r = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const m = xml.match(r);
  return m ? m[1].trim() : '';
}

function parseAtom(xml) {
  const jobs = [];
  const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let m;

  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];

    const title    = getTag(e, 'title');
    const link     = getAttr(e, 'link', 'href') || getTag(e, 'link');
    const category = getAttr(e, 'category', 'label') || getAttr(e, 'category', 'term');
    const summary  = getTag(e, 'summary') || getTag(e, 'content');
    const updated  = getTag(e, 'updated') || getTag(e, 'published');

    // Extract location from summary text
    const locMatch = summary.match(/(?:Location|City|Store)[:\s–\-]+([^\n<|]+)/i);
    const location = locMatch ? locMatch[1].trim() : '';

    if (title) {
      jobs.push({
        title,
        link,
        category: category || 'Open Position',
        location,
        updated,
      });
    }
  }

  return jobs;
}

exports.handler = async function (event) {
  const debug = event.queryStringParameters && event.queryStringParameters.debug === '1';

  for (const url of FEED_URLS) {
    try {
      const { status, body } = await fetchUrl(url);

      if (debug) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
          body: `URL: ${url}\nStatus: ${status}\n\n${body.slice(0, 5000)}`,
        };
      }

      if (status !== 200) continue;

      const jobs = parseAtom(body);
      if (jobs.length === 0 && body.includes('<entry')) {
        // entries exist but parsing failed — return raw snippet for debugging
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ _debug: 'entries found but not parsed', _sample: body.slice(0, 2000) }),
        };
      }

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
      continue;
    }
  }

  return {
    statusCode: 502,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'Could not reach Paycor feed' }),
  };
};
