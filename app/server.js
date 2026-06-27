'use strict';

const express = require('express');
require('dotenv').config();
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { getLanguageStats, GitHubApiError } = require('./github');
const { renderCard } = require('./render');

const PORT = process.env.PORT || 8080;
const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || 'eu-central-1';
const CACHE_TTL_SECONDS = 60 * 60 * 24; 

const s3 = new S3Client({ region: REGION });

const app = express();

function sanitizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function cacheKey(username) {
  return `cards/${username}.svg`;
}

async function readFromCache(username) {
  if (!BUCKET) return null;
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: cacheKey(username) })
    );
    const ageSeconds =
      (Date.now() - new Date(res.LastModified).getTime()) / 1000;
    if (ageSeconds > CACHE_TTL_SECONDS) {
      return null;
    }
    const body = await res.Body.transformToString();
    return body;
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    console.error('S3 read error', err);
    return null; 
  }
}

async function writeToCache(username, svg) {
  if (!BUCKET) return;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: cacheKey(username),
        Body: svg,
        ContentType: 'image/svg+xml',
        CacheControl: `public, max-age=${CACHE_TTL_SECONDS}`,
      })
    );
  } catch (err) {
    console.error('S3 write error', err);
  }
}

app.get('/healthz', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/stats', async (req, res) => {
  const username = sanitizeUsername(req.query.username);
  if (!username) {
    res.status(400).type('text/plain').send('invalid or missing username');
    return;
  }

  const cached = await readFromCache(username);
  if (cached) {
    res
      .status(200)
      .set('Content-Type', 'image/svg+xml')
      .set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)
      .set('X-Cache', 'HIT')
      .send(cached);
    return;
  }

  try {
    const stats = await getLanguageStats(username);
    const svg = renderCard(username, stats);

    await writeToCache(username, svg);

    res
      .status(200)
      .set('Content-Type', 'image/svg+xml')
      .set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)
      .set('X-Cache', 'MISS')
      .send(svg);
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) {
      res.status(404).type('text/plain').send('github user not found');
      return;
    }
    if (err instanceof GitHubApiError && err.status === 429) {
      res
        .status(503)
        .type('text/plain')
        .send('github rate limit reached, try again shortly');
      return;
    }
    console.error('unexpected error', err);
    res.status(500).type('text/plain').send('internal error');
  }
});

app.listen(PORT, () => {
  console.log(`listening on :${PORT}`);
});
