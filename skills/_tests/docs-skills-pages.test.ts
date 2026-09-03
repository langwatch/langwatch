import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { listPublishedSkills } from "../_lib/feature-skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");
const docsRoot = path.resolve(skillsRoot, "..", "docs");
const skillsPagesDir = path.join(docsRoot, "skills");

const manifest: Record<
  string,
  Record<string, { title: string; skill?: string; promptFile: string }[]>
> = JSON.parse(fs.readFileSync(path.join(skillsPagesDir, "skills-pages-manifest.json"), "utf8"));

// Manifest keys are docs-relative paths (e.g. "skills/directory.mdx",
// "agent-testing/connect-your-agent.mdx") since the skill card reached
// pages outside docs/skills/.
const pageFiles = Object.keys(manifest).map((f) => {
  // A key carrying `../` still joins to a readable file, so the suite would
  // validate some unrelated page and report it as a docs page.
  const resolved = path.resolve(docsRoot, f);
  const relative = path.relative(docsRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Manifest key ${f} resolves outside docs/; keys are docs-relative`);
  }
  return { name: f, content: fs.readFileSync(resolved, "utf8") };
});

function extractAll(source: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]!);
  return out;
}

// The generator renders a card in one of two shapes: the ordinary collapsible
// accordion, and the static card, which is always open and carries no toggle.
// Both count as one accordion. The trailing quote keeps this off the nested
// `lw-accordion-header` / `-body` / `-actions` divs.
const ACCORDION_OPEN = /<div className="lw-accordion(?: lw-accordion-static)?"/g;

// A static card's header and the attributes it carries, which must stay empty:
// posthog.js skips `.lw-accordion-static` in its header click handler, so the
// header does nothing when activated and must not claim button semantics.
const STATIC_ACCORDION_HEADER =
  /<div className="lw-accordion lw-accordion-static"[^>]*>\s*<div className="lw-accordion-header"([^>]*)>/g;

// The paths the published langwatch/skills repo actually contains, derived
// from the same selection the publish sync writes (recipes nest under
// recipes/<slug>). The accordion download URLs must only ever reference these.
const publishedPaths = new Set(
  listPublishedSkills(skillsRoot).map((s) => (s.isRecipe ? `recipes/${s.slug}` : s.slug)),
);

describe("docs skills directory pages", () => {
  describe("given the publish sync defines which skills exist in langwatch/skills", () => {
    const manifestSkills = Object.values(manifest).flatMap((sections) =>
      Object.values(sections).flatMap((entries) =>
        entries.filter((e) => e.skill).map((e) => e.skill!.replace("langwatch/skills/", "")),
      ),
    );

    it("only lists skills that resolve inside the published repo layout", () => {
      const unknown = manifestSkills.filter((p) => !publishedPaths.has(p));
      expect(
        unknown,
        `these manifest skills would 404 on raw.githubusercontent.com/langwatch/skills: ${unknown.join(", ")}`,
      ).toEqual([]);
    });

    it("lists every published skill in the manifest", () => {
      const listed = new Set(manifestSkills);
      const missing = [...publishedPaths].filter((p) => !listed.has(p));
      expect(
        missing,
        `published skills missing from the docs directory pages: ${missing.join(", ")}`,
      ).toEqual([]);
    });
  });

  describe("given the pages are generated from the manifest", () => {
    it("embeds a download URL against the published repo for every skill entry", () => {
      for (const { name, content } of pageFiles) {
        const urls = extractAll(content, /data-download-url="([^"]+)"/g);
        const expected = Object.values(manifest[name]!)
          .flatMap((entries) => entries.filter((e) => e.skill))
          .map(
            (e) =>
              `https://raw.githubusercontent.com/langwatch/skills/main/${e.skill!.replace("langwatch/skills/", "")}/SKILL.md`,
          );
        expect(urls.sort(), `${name} download URLs`).toEqual(expected.sort());
      }
    });

    it("never points a download at the monorepo where SKILL.md files do not exist", () => {
      for (const { name, content } of pageFiles) {
        expect(content, name).not.toContain("langwatch/langwatch/main/skills");
      }
    });

    it("renders every manifest accordion with its title and a server-rendered prompt block", () => {
      for (const { name, content } of pageFiles) {
        const entries = Object.values(manifest[name]!).flat();
        const accordions = content.match(ACCORDION_OPEN) ?? [];
        expect(accordions.length, `${name} accordion count`).toBe(entries.length);
        const copyActions = content.match(/data-copy-source="prompt"/g) ?? [];
        expect(copyActions.length, `${name} prompt actions`).toBe(entries.length);
        const promptBlocks = [...content.matchAll(/^(`{4,})text\n([\s\S]*?)^\1$/gm)];
        expect(promptBlocks.length, `${name} prompt fences`).toBe(entries.length);
        for (const block of promptBlocks) {
          expect(block[2]!.length, `${name} prompt fence content`).toBeGreaterThan(200);
        }
      }
    });

    it("keeps data attribute values ASCII-only because the renderer drops non-ASCII attributes", () => {
      for (const { name, content } of pageFiles) {
        const attrValues = [
          ...extractAll(content, /data-[\w-]+="([^"]*)"/g),
          ...extractAll(content, /data-[\w-]+=\{("(?:[^"\\]|\\.)*")\}/g).map(
            (v) => JSON.parse(v) as string,
          ),
        ];
        const offenders = attrValues.filter((v) => /[^\x20-\x7E]/.test(v));
        expect(
          offenders,
          `${name} non-ASCII data attribute values: ${offenders.join(" | ")}`,
        ).toEqual([]);
      }
    });

    it("draws icons with path elements only because the renderer strips polyline and line", () => {
      for (const { name, content } of pageFiles) {
        expect(content, name).not.toMatch(/<polyline[\s>]/);
        expect(content, name).not.toMatch(/<line[\s>]/);
      }
    });

    it("keeps the generated blocks fresh with the manifest ordering", () => {
      for (const { name, content } of pageFiles) {
        for (const [sectionId, entries] of Object.entries(manifest[name]!)) {
          const start = content.indexOf(`{/* lw-generated:${sectionId}:start */}`);
          const end = content.indexOf(`{/* lw-generated:${sectionId}:end */}`);
          expect(start, `${name} ${sectionId} start marker`).toBeGreaterThanOrEqual(0);
          expect(end, `${name} ${sectionId} end marker`).toBeGreaterThan(start);
          const block = content.slice(start, end);
          let cursor = -1;
          for (const entry of entries) {
            const idx = block.indexOf(`data-track-title={${JSON.stringify(entry.title)}}`);
            expect(idx, `${name} ${sectionId}: "${entry.title}" present in order`).toBeGreaterThan(
              cursor,
            );
            cursor = idx;
          }
        }
      }
    });

    it("references only prompt files the skills compiler produces", () => {
      // sync-prompts.sh runs the compiler before generating, so every
      // promptFile in the manifest must be a compiler output name.
      const knownStems = listPublishedSkills(skillsRoot).map((s) =>
        s.isRecipe ? `recipes-${s.slug}` : s.slug,
      );
      const validNames = new Set([
        ...knownStems.map((s) => `${s}.docs.txt`),
        ...knownStems.map((s) => `${s}.platform.txt`),
      ]);
      const bad = Object.values(manifest)
        .flatMap((sections) => Object.values(sections).flat())
        .map((e) => e.promptFile)
        .filter((f) => !validNames.has(f));
      expect(bad, `manifest promptFile entries with no compiler output: ${bad.join(", ")}`).toEqual(
        [],
      );
    });
  });

  describe("when Mintlify renders a page that imports snippets", () => {
    // Snippet component imports (jsx or mdx) render client-side only: the
    // served HTML then misses the accordion content, so crawlers index an
    // empty page. These pages must stay import-free, with all markup
    // generated inline as plain lowercase HTML elements.
    it("keeps the docs skills pages free of any snippet import", () => {
      const offenders = pageFiles.flatMap(({ name, content }) => {
        // Import statements inside fenced code blocks are inert content
        // (the prompts embed Python/TS examples); only page-level ESM counts.
        const withoutFences = content.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1$/gm, "");
        return extractAll(withoutFences, /^(import\s[^\n]*)$/gm).map((line) => `${name}: ${line}`);
      });
      expect(
        offenders,
        `snippet imports disable server-side rendering of the accordions:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    });

    it("uses no details elements because Mintlify strips them server-side", () => {
      for (const { name, content } of pageFiles) {
        expect(content, name).not.toMatch(/<details[\s>]/);
      }
    });
  });

  describe("given the interactivity lives in delegated handlers", () => {
    it("wires the accordion toggle, copy, and download handlers in posthog.js", () => {
      const js = fs.readFileSync(path.join(docsRoot, "posthog.js"), "utf8");
      expect(js).toContain(".lw-accordion-header");
      expect(js).toContain("data-open");
      expect(js).toContain("data-download-url");
      expect(js).toContain("data-copy-source");
      expect(js).toContain(".lw-prompt-source code");
      expect(js, "keyboard activation must cover all interactive controls").toContain(
        ".lw-accordion-header, .lw-accordion-action, .lw-accordion-cmd-box",
      );
    });

    it("marks every interactive control as a focusable button", () => {
      for (const { name, content } of pageFiles) {
        // A static card never toggles, so its header is not an interactive
        // control. The next test pins that it stays inert, which is what keeps
        // this subtraction from hiding a header that lost its semantics.
        const inertHeaders = content.match(STATIC_ACCORDION_HEADER)?.length ?? 0;
        for (const cls of ["lw-accordion-header", "lw-accordion-action", "lw-accordion-cmd-box"]) {
          const total = content.match(new RegExp(`className="${cls}[" ]`, "g"))?.length ?? 0;
          const buttons =
            content.match(
              new RegExp(`className="${cls}[" ][^>]*role="button" tabIndex=\\{0\\}`, "g"),
            )?.length ?? 0;
          const interactive = cls === "lw-accordion-header" ? total - inertHeaders : total;
          expect(buttons, `${name}: ${cls} keyboard semantics`).toBe(interactive);
        }
      }
    });

    it("leaves the static card header inert because nothing handles its click", () => {
      const js = fs.readFileSync(path.join(docsRoot, "posthog.js"), "utf8");
      expect(js, "the header click handler must skip static cards").toContain(
        "lw-accordion-static",
      );
      for (const { name, content } of pageFiles) {
        for (const [, attrs] of content.matchAll(STATIC_ACCORDION_HEADER)) {
          expect(
            attrs!.trim(),
            `${name}: a static card header must claim no button semantics`,
          ).toBe("");
        }
      }
    });

    it("hides and shows the accordion body via the data-open attribute", () => {
      const css = fs.readFileSync(path.join(docsRoot, "style.css"), "utf8");
      expect(css).toContain(".lw-accordion[data-open] .lw-accordion-body");
      expect(css).not.toContain(".lw-accordion[open]");
    });
  });
});
