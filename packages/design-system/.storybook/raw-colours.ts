import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseSync, Visitor } from "oxc-parser";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ALLOWLIST: Record<string, string> = JSON.parse(
  readFileSync(path.join(ROOT, "packages/design-system/raw-colour-allowlist.json"), "utf8"),
);

export function isBrowserColourSource(file: string): boolean {
  return (
    /^(apps\/ui\/src\/|(?:enterprise\/)?modules\/[^/]+\/browser\/src\/)/.test(file) &&
    /\.[cm]?[jt]sx?$/.test(file) &&
    !/(?:^|\/)(__tests__|__fixtures__)\//.test(file) &&
    !/\.(test|spec|stories|fixture)\.[cm]?[jt]sx?$/.test(file)
  );
}

export function isAllowedRawColourFile(file: string): boolean {
  return Object.hasOwn(ALLOWLIST, file);
}

// Inspect literal text, not comments or RGB strings computed from resolved tokens.
const RAW_COLOUR =
  /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(\s*[-+.\d][^()]*\)|\bcolor\(\s*[\w-]+\s+[-+.\d][^()]*\)/gi;

export function rawColourSites({ file, source }: { file: string; source: string }): string[] {
  const { program, errors } = parseSync(file, source, {
    lang: file.endsWith(".tsx") ? "tsx" : "ts",
  });
  if (errors.length) throw new Error(`Cannot scan colours in ${file}: ${errors[0]?.message}`);
  const sites: string[] = [];
  function record(text: string, start: number): void {
    for (const match of text.matchAll(RAW_COLOUR)) {
      // Numeric issue/order references in prose are data, not CSS hex values.
      const prefix = text.slice(0, match.index);
      if (/^#\d+$/.test(match[0]) && /\b(?:issue|order|pull request|PR)\s+$/i.test(prefix)) {
        continue;
      }
      const line = source.slice(0, start + (match.index ?? 0)).split("\n").length;
      sites.push(`${file}:${line}:${match[0]}`);
    }
  }
  new Visitor({
    Literal(node) {
      if (typeof node.value === "string") record(node.value, node.start);
    },
    TemplateElement(node) {
      record(node.value.cooked ?? node.value.raw, node.start);
    },
  }).visit(program);
  return sites;
}

export function collectRawColours({ includeAllowed = false } = {}): string[] {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "apps/ui/src",
      "modules",
      "enterprise/modules",
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return [...new Set(files.split("\0"))]
    .filter(isBrowserColourSource)
    .filter((file) => includeAllowed || !isAllowedRawColourFile(file))
    .filter((file) => existsSync(path.join(ROOT, file)))
    .flatMap((file) =>
      rawColourSites({ file, source: readFileSync(path.join(ROOT, file), "utf8") }),
    );
}
