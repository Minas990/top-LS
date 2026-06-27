'use strict';

//miniamal structured logger: one JSON object per line to stdout/stderr.

let instanceId = process.env.INSTANCE_ID || 'unknown';

function setInstanceId(id) {
  instanceId = id;
}

function baseFields(extra) {
  return {
    timestamp: new Date().toISOString(),
    instanceId,
    ...extra,
  };
}

function log(level, message, fields = {}) {
  const line = JSON.stringify(baseFields({ level, message, ...fields }));
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  info: (message, fields) => log('info', message, fields),
  warn: (message, fields) => log('warn', message, fields),
  error: (message, fields) => log('error', message, fields),
  setInstanceId,
};
