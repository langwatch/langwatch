#!/usr/bin/env node
/**
 * cli-output-to-png — render CLI text output as a PNG screenshot.
 *
 * Used in PR-side dogfood evidence when a full browser screenshot is
 * overkill but a copy-pasted code block is unreadable in PR descriptions.
 *
 * Pipeline: stdin (or --input <file>) -> SVG (monospace, dark theme,
 * preserves whitespace) -> PNG via librsvg's rsvg-convert.
 *
 * Why not playwright: we want this to run without `pnpm install` in
 * fresh worktrees and without a headless Chromium. librsvg is in
 * Homebrew on every contributor's mac and on every CI image we ship.
 *
 * Usage:
 *   echo "$ langwatch claude --help" | node scripts/dogfood/cli-output-to-png.mjs --out shot.png
 *   node scripts/dogfood/cli-output-to-png.mjs --input /tmp/log --out shot.png --title "langwatch claude"
 *
 * Flags:
 *   --input <path>   Read text from file (default: stdin)
 *   --out <path>     Write PNG to path (required)
 *   --title <text>   Optional caption above the terminal box
 *   --width <px>     PNG width in pixels (default 1280)
 *   --bg <color>     Terminal background (default #0d1117 / GitHub dark)
 *   --fg <color>     Text color (default #e6edf3)
 *
 * Exit codes:
 *   0 — wrote PNG
 *   1 — usage error
 *   2 — rsvg-convert failed (likely not installed: `brew install librsvg`)
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FONT_PX = 14;
const LINE_PX = 20;
const PAD_X = 24;
const PAD_Y = 20;
const TITLE_PX = 16;
const TITLE_GAP = 12;
const FONT_FAMILY =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace";

/**
 * @typedef {{ width: number, bg: string, fg: string, input?: string, out?: string, title?: string }} Opts
 */

/**
 * @param {string[]} argv
 * @returns {Opts}
 */
function parseArgs(argv) {
  /** @type {Opts} */
  const out = { width: 1280, bg: "#0d1117", fg: "#e6edf3" };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    switch (flag) {
      case "--input":
      case "-i":
        out.input = val;
        i++;
        break;
      case "--out":
      case "-o":
        out.out = val;
        i++;
        break;
      case "--title":
        out.title = val;
        i++;
        break;
      case "--width":
        out.width = Number(val) || out.width;
        i++;
        break;
      case "--bg":
        if (val) out.bg = val;
        i++;
        break;
      case "--fg":
        if (val) out.fg = val;
        i++;
        break;
      case "--help":
      case "-h":
        process.stderr.write(
          "Usage: cli-output-to-png [--input <path>] --out <path> [--title <text>]\n",
        );
        process.exit(0);
    }
  }
  return out;
}

/** @param {Opts} opts */
function readInput(opts) {
  if (opts.input) return readFileSync(opts.input, "utf8");
  return readFileSync(0, "utf8");
}

/** @param {string} s */
function xmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} s */
function stripAnsi(s) {
  // Remove CSI / OSC / SGR sequences so they don't render literally.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

/**
 * @param {string} text
 * @param {Opts} opts
 */
function buildSvg(text, opts) {
  const lines = stripAnsi(text).split("\n");
  const titleH = opts.title ? TITLE_PX + TITLE_GAP : 0;
  const innerH = lines.length * LINE_PX + PAD_Y * 2;
  const totalH = titleH + innerH;
  const w = opts.width;

  const rows = lines
    .map((/** @type {string} */ line, /** @type {number} */ i) => {
      const y = PAD_Y + (i + 0.85) * LINE_PX;
      return `<text x="${PAD_X}" y="${y}" fill="${opts.fg}" font-family="${FONT_FAMILY}" font-size="${FONT_PX}" xml:space="preserve">${xmlEscape(line || " ")}</text>`;
    })
    .join("\n");

  const title = opts.title
    ? `<text x="${PAD_X}" y="${TITLE_PX}" fill="#8b949e" font-family="${FONT_FAMILY}" font-size="${TITLE_PX - 2}">${xmlEscape(opts.title)}</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${totalH}" viewBox="0 0 ${w} ${totalH}">
  <rect x="0" y="${titleH}" width="${w}" height="${innerH}" fill="${opts.bg}" rx="8" ry="8"/>
  ${title}
  ${rows}
</svg>
`;
}

/**
 * @param {string} svg
 * @param {string} outPath
 */
function svgToPng(svg, outPath) {
  const res = spawnSync(
    "rsvg-convert",
    ["--keep-aspect-ratio", "--format", "png", "--output", outPath],
    {
      input: svg,
    },
  );
  if (res.error || res.status !== 0) {
    const stderr = res.stderr?.toString() || "";
    process.stderr.write(
      `rsvg-convert failed${stderr ? `: ${stderr}` : ""}\nHint: brew install librsvg\n`,
    );
    process.exit(2);
  }
}

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.out) {
    process.stderr.write("Missing --out <path>\n");
    process.exit(1);
  }
  const text = readInput(opts);
  if (!text.length) {
    process.stderr.write("Empty input\n");
    process.exit(1);
  }
  const svg = buildSvg(text, opts);
  svgToPng(svg, opts.out);
  process.stdout.write(`${opts.out}\n`);
}

main();
