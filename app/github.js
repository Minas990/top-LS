'use strict';

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 8;
const USER_AGENT = 'github-stats-card';

class GitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

function authHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 404) {
    throw new GitHubApiError('user not found', 404);
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    throw new GitHubApiError(
      `github rate limited (remaining=${remaining})`,
      429
    );
  }
  if (!res.ok) {
    throw new GitHubApiError(`github error ${res.status}`, res.status);
  }
  return res.json();
}

async function listRepos(username) {
  const repos = [];
  let page = 1;
  for (;;) {
    const url = `${GITHUB_API}/users/${encodeURIComponent(
      username
    )}/repos?per_page=100&page=${page}&type=owner`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch.filter((r) => !r.fork));
    if (batch.length < 100) break;
    page += 1;
  }
  return repos;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runOne() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    runOne
  );
  await Promise.all(workers);
  return results;
}

async function repoLanguages(owner, repoName) {
  try {
    const url = `${GITHUB_API}/repos/${encodeURIComponent(
      owner
    )}/${encodeURIComponent(repoName)}/languages`;
    return await fetchJson(url);
  } catch (err) {
    return {};
  }
}


async function getLanguageStats(username) {
  const repos = await listRepos(username);

  if (repos.length === 0) {
    return [];
  }

  const perRepoLanguages = await mapWithConcurrency(
    repos,
    CONCURRENCY,
    (repo) => repoLanguages(username, repo.name)
  );

  const totals = new Map();
  for (const langMap of perRepoLanguages) {
    for (const [lang, bytes] of Object.entries(langMap)) {
      totals.set(lang, (totals.get(lang) || 0) + bytes);
    }
  }

  const grandTotal = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  if (grandTotal === 0) {
    return [];
  }

  const stats = Array.from(totals.entries())
    .map(([language, bytes]) => ({
      language,
      bytes,
      percent: (bytes / grandTotal) * 100,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return stats;
}

module.exports = { getLanguageStats, GitHubApiError };
