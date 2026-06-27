'use strict';


const PALETTE = [
  '#f34b7d', '#3178c6', '#f1e05a', '#8c8c8c', '#e34c26',
  '#563d7c', '#3572A5', '#dea584', '#b07219', '#701516',
  '#4F5D95', '#384d54', '#89e051', '#384d54', '#384d54',
  '#3D6117', '#00ADD8', '#4eaa25', '#5398be', '#2298c0',
];

const CARD_WIDTH = 560;
const BAR_HEIGHT = 14;
const ROW_HEIGHT = 24;
const COLS = 3;
const PADDING = 24;
const MIN_SEGMENT_WIDTH = 4;

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

function renderTopBar(stats) {
  const usable = CARD_WIDTH - PADDING * 2;
  const minPercentThreshold = (MIN_SEGMENT_WIDTH / usable) * 100;

  const tinyCount = stats.filter((s) => s.percent < minPercentThreshold).length;
  const reserved = tinyCount * MIN_SEGMENT_WIDTH;
  const flexibleUsable = usable - reserved;
  const flexibleTotalPercent = stats.reduce(
    (sum, s) => sum + (s.percent < minPercentThreshold ? 0 : s.percent),
    0
  );

  const segments = [];
  let x = 0;

  stats.forEach((s, i) => {
    const isTiny = s.percent < minPercentThreshold;
    const width = isTiny
      ? MIN_SEGMENT_WIDTH
      : (s.percent / flexibleTotalPercent) * flexibleUsable;
    segments.push(
      `<rect x="${x.toFixed(2)}" y="0" width="${Math.ceil(width).toFixed(
        2
      )}" height="${BAR_HEIGHT}" fill="${colorFor(i)}" />`
    );
    x += width;
  });

  return `<g>${segments.join('')}</g>`;
}

function renderLegend(stats) {
  const colWidth = (CARD_WIDTH - PADDING * 2) / COLS;
  const rows = [];

  stats.forEach((s, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PADDING + col * colWidth;
    const y = BAR_HEIGHT + 28 + row * ROW_HEIGHT;
    const label = escapeXml(s.language);
    const pct = s.percent.toFixed(2);

    rows.push(`
      <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${colorFor(i)}" />
      <text x="${x + 16}" y="${y}" font-family="Helvetica, Arial, sans-serif"
            font-size="12" fill="#e6e6e6">${label} ${pct}%</text>
    `);
  });

  const rowCount = Math.ceil(stats.length / COLS);
  const totalHeight = BAR_HEIGHT + 28 + rowCount * ROW_HEIGHT + 12;

  return { markup: rows.join(''), totalHeight };
}


function renderCard(username, stats) {
  if (stats.length === 0) {
    const height = 90;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${height}">
      <rect width="${CARD_WIDTH}" height="${height}" fill="#0d1117" rx="6"/>
      <text x="${PADDING}" y="${height / 2}" font-family="Helvetica, Arial, sans-serif"
            font-size="14" fill="#e6e6e6">No public repository language data for "${escapeXml(
              username
            )}"</text>
    </svg>`;
  }

  const { markup, totalHeight } = renderLegend(stats);
  const height = totalHeight + 12;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${height}">
    <rect width="${CARD_WIDTH}" height="${height}" fill="#0d1117" rx="6"/>
    <g transform="translate(${PADDING}, 16)">
      <rect width="${CARD_WIDTH - PADDING * 2}" height="${BAR_HEIGHT}" rx="4" fill="#21262d"/>
      <clipPath id="barclip"><rect width="${CARD_WIDTH - PADDING * 2}" height="${BAR_HEIGHT}" rx="4"/></clipPath>
      <g clip-path="url(#barclip)">${renderTopBar(stats)}</g>
    </g>
    <g transform="translate(0, 16)">${markup}</g>
  </svg>`;
}

module.exports = { renderCard };
