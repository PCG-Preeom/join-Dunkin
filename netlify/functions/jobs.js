const https = require('https');

const CLIENT_ID = '8a7883d09be7cb01019c10eb04fa0f97';

const URLS = [
  `https://recruitingbypaycor.com/career/JobBoardAtom.action?clientId=${CLIENT_ID}`,
  `https://recruitingbypaycor.com/career/jobBoardAtom.action?clientId=${CLIENT_ID}`,
  `https://recruitingbypaycor.com/career/atom.action?clientId=${CLIENT_ID}`,
  `https://recruitingbypaycor.com/career/iframe.action?clientId=${CLIENT_ID}`,
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml,application/atom+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, url }));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function decode(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '').trim();
}

// Parse Atom/RSS XML feed
function parseAtom(xml) {
  const jobs = [];
  const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const titleM   = e.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkM    = e.match(/<link[^>]*href="([^"]*)"/i);
    const catLabel = e.match(/label="([^"]*)"/i);
    const catTerm  = e.match(/term="([^"]*)"/i);
    const summaryM = e.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);

    const title    = titleM    ? decode(titleM[1])    : '';
    const link     = linkM     ? linkM[1]             : '';
    const category = catLabel  ? catLabel[1] : (catTerm ? catTerm[1] : 'Open Position');
    const summary  = summaryM  ? decode(summaryM[1])  : '';
    const locMatch = summary.match(/(?:Location|City|Store)[:\s–\-]+([^\n<|]+)/i);

    if (title) jobs.push({ title, link, category, location: locMatch ? locMatch[1].trim() : '' });
  }
  return jobs;
}

// Parse gnewton HTML career page
function parseHtml(html) {
  const jobs = [];
  let currentDept = 'Open Position';

  // Extract department headers
  const deptRe = /gnewtonCareerGroupHeaderClass[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  // Extract job rows — each row has a title link and location
  const rowRe = /gnewtonCareerGroupJobTitleClass[^>]*>([\s\S]*?)<\/(?:td|div|span|li)>/gi;

  // Build a flat list of departments + jobs in document order
  const parts = [];
  let d, r;

  const deptRe2 = /class="gnewtonCareerGroupHeaderClass[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((d = deptRe2.exec(html)) !== null) {
    parts.push({ type: 'dept', index: d.index, text: decode(d[1]) });
  }

  const jobRe = /href="(https?:\/\/recruitingbypaycor\.com\/career\/jobDetails[^"]+)"[^>]*class="gnewtonCareerGroupJobTitleClass[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const jobRe2 = /class="gnewtonCareerGroupJobTitleClass[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  // Try both href-first and class-first patterns
  let j;
  while ((j = jobRe.exec(html)) !== null) {
    parts.push({ type: 'job', index: j.index, link: j[1], title: decode(j[2]) });
  }
  if (!parts.some(p => p.type === 'job')) {
    while ((j = jobRe2.exec(html)) !== null) {
      parts.push({ type: 'job', index: j.index, link: j[1], title: decode(j[2]) });
    }
  }

  // Sort by document order
  parts.sort((a, b) => a.index - b.index);

  parts.forEach(p => {
    if (p.type === 'dept') currentDept = p.text;
    else if (p.type === 'job' && p.title) {
      jobs.push({ title: p.title, link: p.link, category: currentDept, location: '' });
    }
  });

  // Also try simpler pattern
  if (jobs.length === 0) {
    const simpleRe = /href="([^"]*jobDetails[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((j = simpleRe.exec(html)) !== null) {
      const title = decode(j[2]);
      if (title && title.length > 1 && title.length < 100) {
        jobs.push({ title, link: j[1], category: 'Open Position', location: '' });
      }
    }
  }

  return jobs;
}

exports.handler = async function (event) {
  const debug = event.queryStringParameters && event.queryStringParameters.debug === '1';
  const errors = [];

  for (const url of URLS) {
    try {
      const { status, body } = await fetchUrl(url);

      if (debug) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
          body: `URL: ${url}\nStatus: ${status}\n\nFirst 4000 chars:\n${body.slice(0, 4000)}`,
        };
      }

      if (status !== 200) { errors.push(`${url} → ${status}`); continue; }

      const isAtom = body.includes('<entry') || body.includes('<feed');
      const jobs   = isAtom ? parseAtom(body) : parseHtml(body);

      if (jobs.length > 0) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300',
          },
          body: JSON.stringify(jobs),
        };
      }

      errors.push(`${url} → 200 but 0 jobs parsed`);
    } catch (err) {
      errors.push(`${url} → ${err.message}`);
    }
  }

  return {
    statusCode: 502,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'No jobs found', tried: errors }),
  };
};
