const https = require('https');

const CLIENT_ID = process.env.PAYCOR_CLIENT_ID;

const URLS = [
  `https://recruitingbypaycor.com/career/CareerHome.action?clientId=${CLIENT_ID}`,
  `https://recruitingbypaycor.com/career/JobBoardAtom.action?clientId=${CLIENT_ID}`,
  `https://recruitingbypaycor.com/career/jobBoardAtom.action?clientId=${CLIENT_ID}`,
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

// Parse gnewton CareerHome HTML page (handles both table and div-group layouts)
function parseHtml(html) {
  const jobs = [];

  // --- Table layout: <td class="gnewtonJobLink"><a href="...">Title</a></td> <td class="gnewtonJobLocation">...</td>
  const rowRe = /<td[^>]*class="gnewtonJobLink"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/td>\s*<td[^>]*class="gnewtonJobLocation"[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const title = decode(m[2]);
    const location = decode(m[3]).replace(/\s+/g, ' ').trim();
    if (title) jobs.push({ title, link: m[1], category: 'Open Position', location });
  }

  if (jobs.length > 0) return jobs;

  // --- Div-group layout: <div class="gnewtonCareerGroupJobTitleClass"><a href="...">
  const parts = [];
  const deptRe = /<div[^>]*class="gnewtonCareerGroupHeaderClass[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let d;
  while ((d = deptRe.exec(html)) !== null) {
    const text = decode(d[1]);
    if (text) parts.push({ type: 'dept', index: d.index, text });
  }
  const jobRe = /<div[^>]*class="gnewtonCareerGroupJobTitleClass[^"]*"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let j;
  while ((j = jobRe.exec(html)) !== null) {
    const title = decode(j[2]);
    if (title) parts.push({ type: 'job', index: j.index, link: j[1], title, endIndex: j.index + j[0].length });
  }
  parts.sort((a, b) => a.index - b.index);
  let currentDept = 'Open Position';
  parts.forEach(p => {
    if (p.type === 'dept') {
      currentDept = p.text;
    } else if (p.type === 'job') {
      const snippet = html.slice(p.endIndex, p.endIndex + 600);
      const locM = snippet.match(/<div[^>]*class="gnewtonCareerGroupJobDescriptionClass[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const location = locM ? decode(locM[1]).replace(/\s+/g, ' ').trim() : '';
      jobs.push({ title: p.title, link: p.link, category: currentDept, location });
    }
  });

  return jobs;
}

exports.handler = async function (event) {
  const debug = event.queryStringParameters && event.queryStringParameters.debug === '1';
  const errors = [];

  for (const url of URLS) {
    try {
      const { status, body } = await fetchUrl(url);

      if (status !== 200) { errors.push(`${url} → ${status}`); continue; }

      if (debug) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
          body: `URL: ${url}\nStatus: ${status}\n\nFirst 4000 chars:\n${body.slice(0, 4000)}`,
        };
      }

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
