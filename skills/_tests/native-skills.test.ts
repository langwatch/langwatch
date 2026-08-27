import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  listNativeSkills,
  listPublishedSkills,
  renderSkill,
} from "../_compiler/native.js";
import { FEATURE_SKILLS, NATIVE_ONLY_SKILLS } from "../_lib/feature-skills.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const skills = listNativeSkills(skillsRoot);
const publishedSkills = listPublishedSkills(skillsRoot);

// Backs specs/langy/langy-native-skills.feature. Langy loads every published
// skill plus explicitly native-only skills, all from canonical root sources.

describe("native skill generation", () => {
  describe("given the published skill set", () => {
    it("includes every curated feature skill", () => {
      const slugs = skills.map((s) => s.slug);
      for (const f of FEATURE_SKILLS)
        expect(slugs, `missing feature skill: ${f}`).toContain(f);
    });

    it("includes every recipe on disk — what we publish, Langy has", () => {
      const recipeDirs = fs
        .readdirSync(path.join(skillsRoot, "recipes"), { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() &&
            fs.existsSync(path.join(skillsRoot, "recipes", e.name, "SKILL.mdx")),
        )
        .map((e) => e.name)
        .sort();
      const recipeSlugs = skills
        .filter((s) => s.isRecipe)
        .map((s) => s.slug)
        .sort();
      expect(recipeSlugs).toEqual(recipeDirs);
      expect(recipeSlugs.length, "expected recipes to be included").toBeGreaterThan(0);
    });

    it("includes native-only skills without adding them to the public set", () => {
      const nativeSlugs = skills.map((skill) => skill.slug);
      const publishedSlugs = publishedSkills.map((skill) => skill.slug);
      for (const slug of NATIVE_ONLY_SKILLS) {
        expect(nativeSlugs).toContain(slug);
        expect(publishedSlugs).not.toContain(slug);
      }
    });

    it("uses unique opencode-valid slugs (recipes flattened, no collisions)", () => {
      const slugs = skills.map((s) => s.slug);
      expect(new Set(slugs).size, "duplicate slug").toBe(slugs.length);
      for (const slug of slugs) {
        expect(slug, `invalid opencode slug: ${slug}`).toMatch(
          /^[a-z0-9][a-z0-9-]{0,63}$/,
        );
      }
    });
  });

  describe("when a skill is rendered", () => {
    it("opens with opencode frontmatter carrying name and description", () => {
      for (const skill of skills) {
        const m = renderSkill(skill).match(/^---\n([\s\S]*?)\n---\n/);
        expect(m, `${skill.slug}: no frontmatter block`).not.toBeNull();
        expect(m![1], `${skill.slug}: frontmatter missing name`).toMatch(/^name:\s*\S/m);
        expect(m![1], `${skill.slug}: frontmatter missing description`).toMatch(
          /^description:\s*\S/m,
        );
      }
    });

    it("inlines shared partials — no leftover MDX import or unrendered component", () => {
      for (const skill of skills) {
        const noCode = renderSkill(skill)
          .replace(/```[\s\S]*?```/g, "")
          .replace(/`[^`\n]*`/g, "");
        expect(noCode, `${skill.slug}: leftover import`).not.toMatch(
          /^import\s+\w+\s+from\s+['"][^'"]+\.mdx?['"]/m,
        );
        expect(noCode, `${skill.slug}: unrendered component`).not.toMatch(
          /^<[A-Z]\w*\s*\/>\s*$/m,
        );
        expect(noCode, `${skill.slug}: leftover _shared ref`).not.toContain("_shared/");
      }
    });

    it("preserves the published skill content verbatim — not a stripped rewrite", () => {
      const tracing = renderSkill(skills.find((s) => s.slug === "tracing")!);
      expect(tracing).toContain("Add LangWatch Tracing to Your Code");
      expect(tracing).toContain("langwatch trace search");
    });
  });

  // skills/_compiled/native/ is COMMITTED (Dockerfile.langyagent copies it into
  // the manager's go:embed dir at image build), so an edited SKILL.mdx whose
  // author forgot to regenerate ships STALE instructions to Langy. This block
  // turns that silent drift into a red test.
  describe("given the committed _compiled/native output", () => {
    const nativeDir = path.join(skillsRoot, "_compiled", "native");

    it("carries exactly the native skill set — no extras, none missing", () => {
      const committed = fs
        .readdirSync(nativeDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      expect(committed).toEqual(skills.map((s) => s.slug).sort());
    });

    it("matches the sources — regenerate with `bash skills/_compiled/generate.sh`", () => {
      for (const skill of skills) {
        const committed = fs.readFileSync(
          path.join(nativeDir, skill.slug, "SKILL.md"),
          "utf8",
        );
        expect(committed, `${skill.slug}: committed native output is stale`).toBe(
          renderSkill(skill),
        );
      }
    });

    // The Docker build overlays _compiled/native/ over the Go embed tree, so
    // production always ships the compiled set — but a local (host-tier)
    // manager builds from the committed copy, and that copy silently drifted
    // for weeks until Langy ran skills older than the docs. generate.sh now
    // mirrors the whole tree; this pins every file, not just github.
    it("keeps the whole Go embed skill tree synchronized with the compiled set — regenerate with `bash skills/_compiled/generate.sh`", () => {
      const embedRoot = path.resolve(
        skillsRoot,
        "..",
        "services/langyagent/internal/assets/skills",
      );
      const embeddedDirs = fs
        .readdirSync(embedRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      expect(embeddedDirs).toEqual(skills.map((s) => s.slug).sort());
      for (const slug of embeddedDirs) {
        const embedded = fs.readFileSync(path.join(embedRoot, slug, "SKILL.md"), "utf8");
        expect(embedded, `${slug}: Go embed copy is stale`).toBe(
          fs.readFileSync(path.join(nativeDir, slug, "SKILL.md"), "utf8"),
        );
      }
    });
  });

  // A skill body reaches the customer: the agent reads it as tool output, and
  // the reader sees that output in the tool card. So anything in a skill that
  // describes the machine WE run on is a leak, and an address is the shape it
  // took: an answer about where scenario results live carried a worker-side
  // host, which says how the product is wired and nothing about the question.
  //
  // Naming a variable the CUSTOMER sets in their own `.env` is the opposite,
  // and these skills are meant to do it. `LANGWATCH_ENDPOINT` is how the agent
  // learns a project is self-hosted, and `LANGWATCH_API_KEY` is how it works at
  // all; a skill that will not say the names cannot tell the agent where to
  // look. The rule is about what the agent SAYS, not what it reads, and the
  // place to enforce that is the operating contract, which forbids naming a
  // path, a variable or an address of ours in an answer (see the langyagent
  // assets test). Here we only pin that no such address is baked into the text.
  describe("given a skill body a customer can end up reading", () => {
    // A home directory or a machine-local root. No skill has a reason to name
    // one: the agent's own workspace path means nothing to the reader.
    const HOST_PATH =
      /(\/Users\/[a-z0-9._-]+|\/home\/[a-z0-9._-]+|\/root\/|\/private\/tmp\/|\/var\/folders\/)/i;

    // An address only the worker can reach: a loopback host or the container
    // alias for one. A placeholder like `https://lw.acme.internal` is NOT one
    // of these. That is how the setup skill teaches the shape of a self-hosted
    // endpoint the customer will type in, and forbidding it would take the
    // example away for nothing: the reader cannot reach ours because it is
    // loopback, not because it ends in a particular word.
    //
    // A bare `localhost:3000` counts too: it names the same worker port that
    // `http://localhost:3000` does, and a disclosure that drops the scheme
    // would otherwise pass. It needs a port, so the word on its own, in prose
    // saying a self-hosted instance can run locally, still passes.
    //
    // The bare form skips anything already carrying a scheme, because the
    // scheme is what tells the two apart. The voice examples hand the reader
    // `ws://localhost:8765/stream` for the Pipecat bot THEY run, which is a
    // placeholder like `https://lw.acme.internal` and not an address of ours.
    // Only http and https loopback is ours to forbid outright.
    const LOOPBACK_HOST = String.raw`localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal`;
    const WORKER_SIDE_ADDRESS = new RegExp(
      `(https?://(${LOOPBACK_HOST})|(?<!://)\\b(${LOOPBACK_HOST}):\\d{2,5}\\b)`,
      "i",
    );

    /** @scenario "A skill never hands the customer a path from the machine it runs on" */
    it("names no path from the machine the agent runs on", () => {
      for (const skill of skills) {
        const body = renderSkill(skill);
        const found = body.match(HOST_PATH);
        expect(found?.[0], `${skill.slug}: names a host path`).toBeUndefined();
      }
    });

    /** @scenario "A skill never hands the customer an address only the worker can reach" */
    it("names no worker-side address", () => {
      for (const skill of skills) {
        const found = renderSkill(skill).match(WORKER_SIDE_ADDRESS);
        expect(
          found?.[0],
          `${skill.slug}: names an address the reader cannot reach`,
        ).toBeUndefined();
      }
    });

    // The regression this pins is the over-correction, not the leak: the first
    // fix for the leak stripped the variable names out of the setup guidance
    // too, and an agent told only that "the CLI resolves it" has nothing to go
    // and check.
    /** @scenario "The setup guidance still names the variables the agent has to find" */
    it("keeps the endpoint and key variable names in the setup guidance", () => {
      const setup = skills.find((skill) => skill.slug === "setup-lw");
      expect(setup, "setup-lw is not in the shipped set").toBeDefined();
      const body = renderSkill(setup!);
      expect(body).toContain("LANGWATCH_API_KEY");
      expect(body).toContain("LANGWATCH_ENDPOINT");
    });
  });

  // AGENTS.md tells Langy which skill to invoke per user intent. A row naming
  // a skill that isn't in the shipped image teaches the model to hallucinate.
  // The image's skill set is the root-compiled native set Docker overlays into
  // the Go embed directory.
  describe("given Langy's AGENTS.md routing table", () => {
    const readAgentsMd = () =>
      fs.readFileSync(
        path.resolve(
          skillsRoot,
          "..",
          "services",
          "langyagent",
          "internal",
          "assets",
          "AGENTS.md",
        ),
        "utf8",
      );

    /** | user intent | `skill` | primary commands | — rows that name a skill. */
    const routingRows = (): { skill: string; commands: string }[] =>
      readAgentsMd()
        .split("\n")
        .filter((row) => row.startsWith("|"))
        .map((row) => row.split("|").map((cell) => cell.trim()))
        .flatMap((cells) => {
          const skill = cells[2]?.match(/^`([a-z0-9-]+)`$/)?.[1];
          return skill ? [{ skill, commands: cells[3] ?? "" }] : [];
        });

    it("routes only to skills that exist in the shipped image", () => {
      const routed = new Set(routingRows().map((row) => row.skill));
      expect(
        routed.size,
        "no skill rows found — did the routing table move?",
      ).toBeGreaterThan(0);

      const shipped = new Set(skills.map((s) => s.slug));
      for (const name of routed) {
        expect(
          shipped.has(name),
          `AGENTS.md routes to a skill that does not ship: ${name}`,
        ).toBe(true);
      }
    });

    // The commands a row names are the ones the model reaches for. For an
    // evaluation request the type it picks must come from the CATALOG — the
    // accepted set — and never from `evaluator list`, which answers what this
    // project already saved: on a project with none that draws an empty card
    // mid-flow, reading as the create having failed before it was attempted.
    describe("when the row answers an evaluation request", () => {
      const EVALUATION_SKILLS = ["experiments", "online-evaluations"];
      const evaluationRows = () =>
        routingRows().filter((row) => EVALUATION_SKILLS.includes(row.skill));

      /** @scenario The assistant is pointed at the catalog rather than the project's evaluators */
      it("points choosing a type at the type catalog", () => {
        const rows = evaluationRows();
        expect(
          rows.map((row) => row.skill).sort(),
          "the evaluation routing rows moved — this check is scanning nothing",
        ).toEqual([...EVALUATION_SKILLS].sort());

        for (const row of rows) {
          expect(
            row.commands,
            `${row.skill} does not name the evaluator type catalog`,
          ).toContain("langwatch evaluator types");
        }
      });

      it("never names listing the project's saved evaluators as a step", () => {
        for (const row of evaluationRows()) {
          expect(
            row.commands,
            `${row.skill} sends the model to the evaluator library`,
          ).not.toContain("langwatch evaluator list");
        }
      });
    });
  });
});
