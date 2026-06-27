'use strict';

const express = require('express');
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
  GetItemCommand,
  DescribeTableCommand,
} = require('@aws-sdk/client-dynamodb');
const { getLanguageStats, GitHubApiError } = require('./github');
const { renderCard } = require('./render');
const logger = require('./logger');
const { getInstanceId } = require('./instance-metadata');

const PORT = process.env.PORT || 8080;
const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;
const TABLE = process.env.DYNAMODB_TABLE;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const PENDING_LOCK_SECONDS = 30;
const SHUTDOWN_GRACE_MS = 25_000;


const missingEnv = [];
if (!REGION) missingEnv.push('AWS_REGION');
if (!BUCKET) missingEnv.push('S3_BUCKET');
if (!TABLE) missingEnv.push('DYNAMODB_TABLE');

if (missingEnv.length > 0) {

  process.stderr.write(
    `FATAL: missing required environment variables: ${missingEnv.join(', ')}\n`
  );
  process.exit(1);
}

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });

function cacheKey(username) {
  return `cards/${username}.svg`;
}

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

function sanitizeUsername(raw) {

  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

async function tryClaim(username, requestId) {
  const expiresAt = nowEpoch() + CACHE_TTL_SECONDS;

  try {
    await ddb.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: {
          username: { S: username },
          status: { S: 'pending' },
          updatedAt: { N: String(nowEpoch()) },
          expiresAt: { N: String(expiresAt) },
        },
        ConditionExpression: 'attribute_not_exists(username)',
      })
    );
    return { claimed: true };
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      logger.error('dynamodb claim failed', { requestId, username, err: err.message });
      return { claimed: true };
    }
  }

  try {
    const existing = await ddb.send(
      new GetItemCommand({
        TableName: TABLE,
        Key: { username: { S: username } },
      })
    );
    const item = existing.Item;
    if (!item) return { claimed: true };

    const status = item.status?.S;
    const updatedAt = Number(item.updatedAt?.N || 0);
    const isStalePending =
      status === 'pending' && nowEpoch() - updatedAt > PENDING_LOCK_SECONDS;

    if (status === 'done') return { claimed: false, status: 'done' };
    if (status === 'pending' && !isStalePending) {
      return { claimed: false, status: 'pending' };
    }
    return { claimed: true };
  } catch (err) {
    logger.error('dynamodb read failed', { requestId, username, err: err.message });
    return { claimed: true };
  }
}

async function markDone(username, requestId) {
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { username: { S: username } },
        UpdateExpression: 'SET #s = :done, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':done': { S: 'done' },
          ':now': { N: String(nowEpoch()) },
        },
      })
    );
  } catch (err) {
    logger.error('dynamodb markDone failed', { requestId, username, err: err.message });
  
  
  }
}

async function readFromCache(username, requestId) {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: cacheKey(username) })
    );
    const ageSeconds = (Date.now() - new Date(res.LastModified).getTime()) / 1000;
    if (ageSeconds > CACHE_TTL_SECONDS) return null;
    return await res.Body.transformToString();
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    logger.error('s3 read failed', { requestId, username, err: err.message });
    return null;
  }
}

async function writeToCache(username, svg, requestId) {
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
    logger.error('s3 write failed', { requestId, username, err: err.message });
  
  }
}


const app = express();
app.disable('x-powered-by');

let isShuttingDown = false;

app.use((req, res, next) => {
  req.requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (isShuttingDown) {
    res.set('Connection', 'close');
  }
  next();
});

app.get('/healthz', async (req, res) => {
  if (isShuttingDown) {
    res.status(503).type('text/plain').send('shutting down');
    return;
  }

  try {
    await Promise.all([
      s3.send(new HeadBucketCommand({ Bucket: BUCKET })),
      ddb.send(new DescribeTableCommand({ TableName: TABLE })),
    ]);
    res.status(200).type('text/plain').send('ok');
  } catch (err) {
    logger.error('healthz dependency check failed', {
      requestId: req.requestId,
      err: err.message,
    });
    res.status(503).type('text/plain').send('dependency check failed');
  }
});

app.get('/stats', async (req, res) => {
  const { requestId } = req;
  const username = sanitizeUsername(req.query.username);

  if (!username) {
    res.status(400).type('text/plain').send('invalid or missing username');
    return;
  }

  logger.info('stats request received', { requestId, username });

  const cached = await readFromCache(username, requestId);
  if (cached) {
    logger.info('stats served from cache', { requestId, username });
    res
      .status(200)
      .set('Content-Type', 'image/svg+xml')
      .set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)
      .set('X-Cache', 'HIT')
      .send(cached);
    return;
  }

  const claim = await tryClaim(username, requestId);

  if (!claim.claimed && claim.status === 'done') {
  
  
  
    const retryRead = await readFromCache(username, requestId);
    if (retryRead) {
      logger.info('stats served from cache on retry', { requestId, username });
      res
        .status(200)
        .set('Content-Type', 'image/svg+xml')
        .set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)
        .set('X-Cache', 'HIT')
        .send(retryRead);
      return;
    }
  }

  if (!claim.claimed && claim.status === 'pending') {
    logger.info('stats request already in progress elsewhere', { requestId, username });
    res
      .status(202)
      .type('text/plain')
      .send('already computing this user, try again shortly');
    return;
  }

  try {
    const stats = await getLanguageStats(username);
    const svg = renderCard(username, stats);

    await writeToCache(username, svg, requestId);
    await markDone(username, requestId);

    logger.info('stats computed', { requestId, username, languageCount: stats.length });

    res
      .status(200)
      .set('Content-Type', 'image/svg+xml')
      .set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)
      .set('X-Cache', 'MISS')
      .send(svg);
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) {
      logger.info('github user not found', { requestId, username });
      res.status(404).type('text/plain').send('github user not found');
      return;
    }
    if (err instanceof GitHubApiError && err.status === 429) {
      logger.warn('github rate limited', { requestId, username });
      res.status(503).type('text/plain').send('github rate limit reached, try again shortly');
      return;
    }
    logger.error('unexpected error handling stats request', {
      requestId,
      username,
      err: err.message,
      stack: err.stack,
    });
    res.status(500).type('text/plain').send('internal error');
  }
});


let server;

async function start() {
  const detectedId = await getInstanceId();
  logger.setInstanceId(detectedId);
  logger.info('starting up', { port: PORT, bucket: BUCKET, table: TABLE });

  server = app.listen(PORT, () => {
    logger.info('listening', { port: PORT });
  });
}

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('shutdown signal received, draining connections', { signal });

  server.close(() => {
    logger.info('all connections drained, exiting');
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('shutdown grace period exceeded, forcing exit');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  logger.error('unhandled rejection', { err: err?.message, stack: err?.stack });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaught exception', { err: err?.message, stack: err?.stack });
  process.exit(1);
});

start();
