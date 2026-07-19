// Generates the skill accordion markup inside docs/skills pages, between
// {/* lw-generated:<section>:start */} and {/* lw-generated:<section>:end */}
// markers, from docs/skills/skills-pages-manifest.json plus the compiled
// prompts in skills/_compiled/.
//
// The markup is plain lowercase HTML elements on purpose: Mintlify only
// server-renders page content, never components imported from snippets, and
// it strips <details>/<summary> entirely, so a div-based accordion driven by
// docs/posthog.js (event delegation on data attributes) is the only shape
// that both renders server-side for search engines and stays interactive.
//
// Mintlify's server pipeline also drops attributes whose values contain
// non-ASCII characters (or grow into multi-kilobyte multi-line strings) and
// strips <polyline>/<line> from svg icons, so: prompts ship as hidden fenced
// code blocks (real content, copied via data-copy-source in posthog.js),
// every icon uses <path>-only drawing, and only short ASCII values may go
// into data attributes.
//
// Run via: bash docs/scripts/sync-prompts.sh (compiles skills first)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(docsRoot, "..");
const compiledDir = path.join(repoRoot, "skills", "_compiled");
const pagesDir = path.join(docsRoot, "skills");
const manifest = JSON.parse(fs.readFileSync(path.join(pagesDir, "skills-pages-manifest.json"), "utf8"));

// Escape text that lands in JSX text position so MDX cannot reinterpret it
// as markup, expressions, or markdown emphasis.
const escapeText = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/\*/g, "&#42;")
    .replace(/_/g, "&#95;")
    .replace(/`/g, "&#96;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;");

// Attribute values as JSX expressions: JSON strings survive any content on a
// single line, including the multi-paragraph prompts.
const attr = (v) => `{${JSON.stringify(v)}}`;

const ICONS = {
  chevron:
    '<svg className="lw-accordion-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9L12 15L18 9" /></svg>',
  copySmall:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>',
  checkSmall:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17L4 12" /></svg>',
  copyLarge:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>',
  checkLarge:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17L4 12" /></svg>',
  download:
    '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.25 3.75H2.75C1.64543 3.75 0.75 4.64543 0.75 5.75V12.25C0.75 13.3546 1.64543 14.25 2.75 14.25H15.25C16.3546 14.25 17.25 13.3546 17.25 12.25V5.75C17.25 4.64543 16.3546 3.75 15.25 3.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M8.75 11.25V6.75H8.356L6.25 9.5L4.144 6.75H3.75V11.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M11.5 9.5L13.25 11.25L15 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M13.25 11.25V6.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>',
};

function cmdBox({ copyValue, code, track, trackProps }) {
  const trackAttrs = Object.entries(trackProps)
    .map(([k, v]) => `data-track-${k}=${attr(v)}`)
    .join(" ");
  return [
    `    <div className="lw-accordion-cmd-box" data-copy=${attr(copyValue)} data-track="${track}" ${trackAttrs}>`,
    `      ${code}`,
    `      <span className="lw-inline-copy-btn lw-copy-line-icon">${ICONS.copySmall}</span>`,
    `      <span className="lw-inline-copy-btn lw-copy-line-check" style={{ display: "none" }}>${ICONS.checkSmall}</span>`,
    `    </div>`,
  ].join("\n");
}

function renderAccordion(entry) {
  const { title, boldPrefix, skill, slashCommand, promptFile } = entry;
  const prompt = fs.readFileSync(path.join(compiledDir, promptFile), "utf8");
  const installCmd = skill ? `npx skills add ${skill}` : null;
  const skillPath = skill ? skill.replace("langwatch/skills/", "") : null;
  const titleHtml = boldPrefix
    ? `<strong>${escapeText(boldPrefix)}</strong> ${escapeText(title)}`
    : escapeText(title);

  const lines = [];
  lines.push(`<div className="lw-accordion">`);
  lines.push(`  <div className="lw-accordion-header" role="button" tabIndex={0} aria-expanded="false">`);
  lines.push(`    <span className="lw-accordion-title">${titleHtml}</span>`);
  lines.push(`    ${ICONS.chevron}`);
  lines.push(`  </div>`);
  lines.push(`  <div className="lw-accordion-body">`);

  if (installCmd) {
    lines.push(`    <div className="lw-accordion-commands">`);
    lines.push(`      <div className="lw-accordion-cmd-col">`);
    lines.push(`        <div className="lw-accordion-cmd-label">Install via CLI</div>`);
    lines.push(
      cmdBox({
        copyValue: installCmd,
        code: `<code>${escapeText(installCmd)}</code>`,
        track: "docs_copy_skill_install",
        trackProps: { title, skill },
      })
        .split("\n")
        .map((l) => "    " + l)
        .join("\n")
    );
    lines.push(`      </div>`);
    if (slashCommand) {
      lines.push(`      <div className="lw-accordion-cmd-col">`);
      lines.push(`        <div className="lw-accordion-cmd-label">Skill Usage</div>`);
      lines.push(
        cmdBox({
          copyValue: slashCommand,
          code: `<code><span className="lw-slash-command">${escapeText(slashCommand)}</span></code>`,
          track: "docs_copy_slash_command",
          trackProps: { title, command: slashCommand },
        })
          .split("\n")
          .map((l) => "    " + l)
          .join("\n")
      );
      lines.push(`      </div>`);
    }
    lines.push(`    </div>`);
  }

  // The fence must be longer than any backtick run inside the prompt so the
  // prompt text survives verbatim as server-rendered (hidden) content.
  const longestBacktickRun = Math.max(3, ...[...prompt.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longestBacktickRun + 1);
  lines.push(`    <div className="lw-accordion-actions${!skill ? " lw-accordion-actions-single" : ""}">`);
  lines.push(
    `      <div className="lw-accordion-action" data-copy-source="prompt" data-track="docs_copy_prompt" data-track-title=${attr(title)} data-track-skill=${attr(skill || "platform")}>`
  );
  lines.push(`        <span className="lw-accordion-action-icon lw-copy-line-icon">${ICONS.copyLarge}</span>`);
  lines.push(
    `        <span className="lw-accordion-action-icon lw-copy-line-check" style={{ display: "none" }}>${ICONS.checkLarge}</span>`
  );
  lines.push(`        <span className="lw-accordion-action-text">`);
  lines.push(`          <span className="lw-accordion-action-title">Copy Full Prompt</span>`);
  lines.push(
    `          <span className="lw-accordion-action-subtitle">${skill ? "Run skill without installing" : "Paste into any AI assistant"}</span>`
  );
  lines.push(`        </span>`);
  lines.push(`        <div className="lw-prompt-source">`);
  lines.push(``);
  lines.push(fence + "text");
  lines.push(prompt.replace(/\n$/, ""));
  lines.push(fence);
  lines.push(``);
  lines.push(`        </div>`);
  lines.push(`      </div>`);
  if (skill) {
    const downloadUrl = `https://raw.githubusercontent.com/langwatch/skills/main/${skillPath}/SKILL.md`;
    lines.push(
      `      <div className="lw-accordion-action" data-download-url="${downloadUrl}" data-download-name="SKILL.md" data-track="docs_download_skill" data-track-title=${attr(title)} data-track-skill=${attr(skill)}>`
    );
    lines.push(`        <span className="lw-accordion-action-icon">${ICONS.download}</span>`);
    lines.push(`        <span className="lw-accordion-action-text">`);
    lines.push(`          <span className="lw-accordion-action-title">Download SKILL.md</span>`);
    lines.push(`          <span className="lw-accordion-action-subtitle">Manual installation</span>`);
    lines.push(`        </span>`);
    lines.push(`      </div>`);
  }
  lines.push(`    </div>`);
  lines.push(`  </div>`);
  lines.push(`</div>`);
  return lines.join("\n");
}

let failed = false;
for (const [pageFile, sections] of Object.entries(manifest)) {
  const pagePath = path.join(pagesDir, pageFile);
  let content = fs.readFileSync(pagePath, "utf8");
  for (const [sectionId, entries] of Object.entries(sections)) {
    const start = `{/* lw-generated:${sectionId}:start */}`;
    const end = `{/* lw-generated:${sectionId}:end */}`;
    const startIdx = content.indexOf(start);
    const endIdx = content.indexOf(end);
    if (startIdx === -1 || endIdx === -1) {
      console.error(`ERROR: markers for section "${sectionId}" not found in ${pageFile}`);
      failed = true;
      continue;
    }
    const generated = entries.map(renderAccordion).join("\n\n");
    content = content.slice(0, startIdx + start.length) + "\n\n" + generated + "\n\n" + content.slice(endIdx);
  }
  fs.writeFileSync(pagePath, content);
  console.log(`Generated skill accordions in docs/skills/${pageFile}`);
}
if (failed) process.exit(1);
