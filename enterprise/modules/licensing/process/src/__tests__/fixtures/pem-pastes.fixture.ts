/**
 * PEM key paste shapes from copy/paste. Three test layers iterate this list, so
 * new shapes added here cover all layers automatically.
 */
export function mangledPemPastes(canonicalKey: string): Record<string, string> {
  const perLine = (transform: (line: string) => string) =>
    canonicalKey.split("\n").map(transform).join("\n");

  return {
    "leading space before BEGIN": ` ${canonicalKey}`,
    "trailing spaces after END": `${canonicalKey.trimEnd()}   `,
    "trailing spaces and newline after END": `${canonicalKey.trimEnd()}   \n`,
    "surrounded by blank lines and spaces": `\n  \n${canonicalKey}  \n \n`,
    "every line indented": perLine((line) => `    ${line}`),
    "every line tab-indented": perLine((line) => `\t${line}`),
    "trailing space on every line": perLine((line) => `${line} `),
    "newlines collapsed into spaces": canonicalKey.replace(/\n/g, " "),
    "newlines stripped entirely": canonicalKey.replace(/\n/g, ""),
    "CRLF line endings": canonicalKey.replace(/\n/g, "\r\n"),
    "escaped newlines from a .env value": canonicalKey.replace(/\n/g, "\\n"),
    "UTF-8 byte order mark": `﻿${canonicalKey}`,
  };
}

/** The canonical form of a key: no surrounding whitespace, one trailing newline. */
export function canonicalPemKey(key: string): string {
  return `${key.trim()}\n`;
}
