'use strict';

const IMDS_BASE = 'http://169.254.169.254';
const TOKEN_TTL_SECONDS = 21600;
const TIMEOUT_MS = 1000;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getInstanceId() {
  try {
    const tokenRes = await fetchWithTimeout(`${IMDS_BASE}/latest/api/token`, {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': String(TOKEN_TTL_SECONDS) },
    });
    if (!tokenRes.ok) return 'local';
    const token = await tokenRes.text();

    const idRes = await fetchWithTimeout(`${IMDS_BASE}/latest/meta-data/instance-id`, {
      headers: { 'X-aws-ec2-metadata-token': token },
    });
    if (!idRes.ok) return 'local';
    return (await idRes.text()).trim();
  } catch (err) {
    return 'local';
  }
}

module.exports = { getInstanceId };
