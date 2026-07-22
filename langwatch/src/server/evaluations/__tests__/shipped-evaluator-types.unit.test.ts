/**
 * Nothing we ship may teach an evaluator type the platform would reject.
 *
 * The failure this pins is not hypothetical: an agent created an evaluator
 * with `langevals/llm_judge` — a slug that has never existed — because our own
 * help text, empty-state hint and skill examples taught it. The request was
 * guaranteed a 422, and the recovery cost a handful of wasted tool calls.
 *
 * Correcting the known instances (as the original fix did) leaves the next
 * stale example free to appear the moment an evaluator is renamed. So the RULE
 * is pinned here rather than the values: every slug any shipped instruction
 * puts in an evaluator-type position is checked against the catalog the create
 * route actually validates against.
 *
 * A rename that breaks this test is telling the truth — update the examples it
 * names, do not widen the scan.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { AVAILABLE_EVALUATORS } from "../evaluators";

const repoRoot = path.resolve(__dirname, "../../../../..");

/**
 * The documents that TEACH — the ones an agent or a developer copies from.
 * Skill sources and their compiled counterparts both ship, so both are read:
 * the compiled tree is what the in-product assistant actually loads.
 */
function shippedInstructionFiles(): string[] {
  const files: string[] = [
    path.join(repoRoot, "services/langyagent/internal/assets/AGENTS.md"),
    path.join(repoRoot, "feature-map.json"),
  ];

  const skillsRoot = path.join(repoRoot, "skills");
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const source = path.join(skillsRoot, entry.name, "SKILL.mdx");
    if (fs.existsSync(source)) files.push(source);
  }

  const nativeRoot = path.join(skillsRoot, "_compiled/native");
  if (fs.existsSync(nativeRoot)) {
    for (const entry of fs.readdirSync(nativeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const compiled = path.join(nativeRoot, entry.name, "SKILL.md");
      if (fs.existsSync(compiled)) files.push(compiled);
    }
  }

  return files.filter((file) => fs.existsSync(file));
}

/**
 * Positions where the next token IS an evaluator type — never a package name,
 * a model id, or a docs path. Narrow on purpose: a scan that guesses would
 * either miss the real thing or fail on prose, and both make it ignorable.
 */
const EVALUATOR_TYPE_POSITIONS: RegExp[] = [
  // `langwatch evaluator create "X" --type <slug>` / `--type=<slug>`
  /--type[= ]+["']?([a-z0-9_-]+\/[a-z0-9_.-]+)["']?/g,
  // `experiment.evaluate("<slug>"` / `evaluation.run("<slug>"`
  /(?:\.evaluate|\.run)\(\s*["']([a-z0-9_-]+\/[a-z0-9_.-]+)["']/g,
  // `"evaluatorType": "<slug>"` and its snake-case spelling
  /"?evaluator_?[Tt]ype"?\s*[:=]\s*["']([a-z0-9_-]+\/[a-z0-9_.-]+)["']/g,
];

interface TaughtType {
  slug: string;
  file: string;
}

function evaluatorTypesTaughtIn(file: string): TaughtType[] {
  const contents = fs.readFileSync(file, "utf8");
  const found: TaughtType[] = [];

  for (const pattern of EVALUATOR_TYPE_POSITIONS) {
    // Fresh lastIndex per file — these are module-level /g regexes.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(contents)) !== null) {
      const slug = match[1];
      if (slug) found.push({ slug, file: path.relative(repoRoot, file) });
    }
  }

  return found;
}

describe("the evaluator types our shipped instructions teach", () => {
  const taught = shippedInstructionFiles().flatMap(evaluatorTypesTaughtIn);

  describe("when an instruction puts a slug in an evaluator-type position", () => {
    it("only ever names a type the platform accepts", () => {
      const invalid = taught.filter(
        ({ slug }) => !(slug in AVAILABLE_EVALUATORS),
      );

      expect(
        invalid.map(({ slug, file }) => `${slug} (${file})`),
      ).toEqual([]);
    });
  });

  describe("when checking the scan itself", () => {
    // A scan that silently matches nothing would pass forever while the
    // examples rot — the assertion above is only worth anything if this holds.
    it("finds the examples the create-performing skills carry", () => {
      expect(taught.length).toBeGreaterThan(0);
    });

    it("would catch the slug the original failure was built on", () => {
      const [sample] = evaluatorTypesTaughtIn(
        writeTempInstruction(
          'langwatch evaluator create "x" --type langevals/llm_judge',
        ),
      );

      expect(sample?.slug).toBe("langevals/llm_judge");
      expect("langevals/llm_judge" in AVAILABLE_EVALUATORS).toBe(false);
    });
  });
});

/** A throwaway file, so the scan is exercised rather than re-implemented. */
function writeTempInstruction(contents: string): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "lw-eval-types-")),
    "SKILL.mdx",
  );
  fs.writeFileSync(file, contents, "utf8");
  return file;
}
