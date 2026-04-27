import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sync } from "../_publish/sync.js";

const EXTERNAL_LINK = /^(https?:|mailto:|#|\{\{)/;

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function stripCode(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
}

function extractLinks(markdown: string): { text: string; url: string }[] {
  const links: { text: string; url: string }[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  const stripped = stripCode(markdown);
  while ((m = re.exec(stripped)) !== null) {
    links.push({ text: m[1]!, url: m[2]! });
  }
  return links;
}

describe("sync publishes self-contained skills", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-sync-"));
    // sync() refuses to wipe a target without a .git dir — simulate a real
    // checkout of langwatch/skills with an empty marker.
    fs.mkdirSync(path.join(tmpDir, ".git"));
    sync(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces at least one SKILL.md per expected skill", () => {
    const files = listMarkdown(tmpDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith("/tracing/SKILL.md"))).toBe(true);
    expect(files.some((f) => f.includes("/recipes/"))).toBe(true);
  });

  it("contains no relative markdown links in any published SKILL.md", () => {
    const offenders: string[] = [];
    for (const file of listMarkdown(tmpDir)) {
      const content = fs.readFileSync(file, "utf8");
      for (const { text, url } of extractLinks(content)) {
        if (!EXTERNAL_LINK.test(url)) {
          offenders.push(`${path.relative(tmpDir, file)}: [${text}](${url})`);
        }
      }
    }
    expect(offenders, `local links must be inlined, not published as-is:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("contains no leftover MDX syntax or unresolved partial markers", () => {
    for (const file of listMarkdown(tmpDir)) {
      // Strip fenced code blocks so we don't trip on Python/TS imports in examples.
      const content = stripCode(fs.readFileSync(file, "utf8"));
      expect(content, `${path.relative(tmpDir, file)} still contains an ESM import`)
        .not.toMatch(/^import\s+\w+\s+from\s+['"][^'"]+\.mdx?['"]/m);
      // Block-level JSX self-closing element like `<Component />` on its own line.
      expect(content, `${path.relative(tmpDir, file)} still contains an unrendered JSX component`)
        .not.toMatch(/^<[A-Z]\w*\s*\/>\s*$/m);
      // The original publish bug: an unresolved `_shared/...` reference or a
      // `[Reference: ...]` placeholder making it into the published output.
      expect(content, `${path.relative(tmpDir, file)} still contains a _shared reference`)
        .not.toContain("_shared/");
      expect(content, `${path.relative(tmpDir, file)} still contains an unresolved [Reference:] stub`)
        .not.toMatch(/\[Reference:\s*[^\]]+\]/);
    }
  });

  it("refuses to sync into a target without a .git directory", () => {
    const noGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-sync-nogit-"));
    try {
      expect(() => sync(noGitDir)).toThrow(/no \.git directory/);
      // Confirm no destructive wipe happened: dir is still empty.
      expect(fs.readdirSync(noGitDir)).toEqual([]);
    } finally {
      fs.rmSync(noGitDir, { recursive: true, force: true });
    }
  });

  it("preserves intra-word underscores in identifiers like LANGWATCH_API_KEY", () => {
    // Regression guard: remark-stringify over-escapes `LANGWATCH_API_KEY`
    // to `LANGWATCH\_API\_KEY` by default. inlineMdx unescapes them.
    for (const file of listMarkdown(tmpDir)) {
      const content = fs.readFileSync(file, "utf8");
      expect(content, `${path.relative(tmpDir, file)} contains over-escaped underscore`)
        .not.toMatch(/[A-Za-z]\\_[A-Za-z]/);
    }
  });
});
