/**
 * Composes the sandboxed frame's document.
 *
 * The init-race fix lives here: the author's HTML is embedded as an inert
 * `<template id="lw-author">` and the shim is the ONLY directly-executed
 * script. The shim activates the template only after `lw:init` has set
 * `LW.params`/`LW.theme` and wired the port, so author code may read them
 * synchronously at its first line.
 */

import { buildShimScript } from "./bridge/shimSource";

const TEMPLATE_OPEN = /<template\b/gi;
const TEMPLATE_CLOSE = /<\/template/gi;
const SCRIPT_OPEN = /<script\b/gi;
const SCRIPT_CLOSE = /<\/script/gi;

interface Token {
  readonly index: number;
  readonly length: number;
  readonly kind:
    | "template-open"
    | "template-close"
    | "script-open"
    | "script-close";
}

function tokensOf(html: string): Token[] {
  const tokens: Token[] = [];
  for (const [regex, kind] of [
    [TEMPLATE_OPEN, "template-open"],
    [TEMPLATE_CLOSE, "template-close"],
    [SCRIPT_OPEN, "script-open"],
    [SCRIPT_CLOSE, "script-close"],
  ] as const) {
    regex.lastIndex = 0;
    for (let match = regex.exec(html); match; match = regex.exec(html)) {
      tokens.push({ index: match.index, length: match[0].length, kind });
    }
  }
  return tokens.sort((a, b) => a.index - b.index);
}

/**
 * Neutralises only the `</template>` sequences that would prematurely close
 * the wrapper template.
 *
 * Balanced nested `<template>` pairs are legal inside a template and pass
 * through untouched, as does a literal `"</template>"` inside a `<script>`'s
 * raw text (the HTML parser only leaves script raw-text mode on `</script`,
 * so such a string cannot close the wrapper). Only an UNMATCHED close tag in
 * markup position is rewritten to its entity form — it would have been a
 * parse error anyway, so rendering it as text loses nothing.
 */
export function escapeAuthorHtml(html: string): string {
  const replacements: { index: number; length: number }[] = [];
  let templateDepth = 0;
  let inScript = false;
  for (const token of tokensOf(html)) {
    if (inScript) {
      // Script raw text: everything except the closing script tag is inert.
      if (token.kind === "script-close") inScript = false;
      continue;
    }
    if (token.kind === "script-open") inScript = true;
    else if (token.kind === "template-open") templateDepth += 1;
    else if (token.kind === "template-close") {
      if (templateDepth > 0) templateDepth -= 1;
      else replacements.push({ index: token.index, length: "</".length });
    }
  }
  let out = html;
  for (const { index } of replacements.reverse()) {
    out = `${out.slice(0, index)}&lt;/${out.slice(index + 2)}`;
  }
  return out;
}

export function buildSrcdoc(authorHtml: string): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    "<style>body{margin:8px;font-family:system-ui,sans-serif;font-size:13px;}</style>",
    "</head><body>",
    `<script>${buildShimScript()}</script>`,
    `<template id="lw-author">${escapeAuthorHtml(authorHtml)}</template>`,
    "</body></html>",
  ].join("\n");
}
