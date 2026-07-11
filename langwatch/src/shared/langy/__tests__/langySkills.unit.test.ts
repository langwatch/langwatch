import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSkills,
  skillSourceDirs,
} from "../../../../scripts/generate-langy-skills";
import GENERATED from "../langySkills.generated.json";
import { LANGY_SKILLS, findSkill } from "../langySkills";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

/**
 * The catalogue must match the IMAGE, not our memory of it.
 *
 * This has been wrong twice and both times a test like this would have caught it
 * on the commit that broke it: once the list promised 13 tools that did not
 * exist, and once it offered 1 skill when the worker installs 14. The list is
 * only ever as trustworthy as its derivation, so this re-derives from disk — via
 * the Dockerfile's own COPY set — and fails if the committed catalogue has
 * drifted from what the worker actually gets.
 */
describe("given the Langy skill catalogue", () => {
  describe("when the image's skill directories are re-read from disk", () => {
    it("matches the committed catalogue exactly", () => {
      const derived = deriveSkills(REPO_ROOT);

      // If this fails: run `pnpm generate:langy-skills`. A skill was added to (or
      // removed from) the worker image and the palette has not been told.
      expect(GENERATED).toEqual(derived);
    });

    it("reads its source directories out of the Dockerfile, not a hardcoded list", () => {
      const dockerfile = fs.readFileSync(
        path.join(REPO_ROOT, "Dockerfile.langyagent"),
        "utf8",
      );

      // The union the Dockerfile assembles into /opt/langy-templates/skills/ —
      // which the worker then symlinks into opencode's discovery path. Both, or
      // the catalogue is only telling half the truth (which is how it came to
      // list one skill out of fourteen).
      expect(skillSourceDirs(dockerfile)).toEqual([
        "skills/_compiled/native",
        "services/langyagent/skills",
      ]);
    });
  });

  describe("when the worker installs a skill", () => {
    it("offers every one of them, and nothing it does not install", () => {
      const installed = deriveSkills(REPO_ROOT)
        .map((skill) => skill.id)
        .sort();
      const offered = LANGY_SKILLS.filter(
        (skill) => skill.source === "agent-skill" || skill.source === "recipe",
      )
        .map((skill) => skill.id)
        .sort();

      expect(offered).toEqual(installed);
      // The regression, stated plainly: the palette used to offer exactly one.
      expect(offered.length).toBeGreaterThan(1);
      expect(offered).toContain("github");
      expect(offered).toContain("tracing");
    });
  });

  describe("when a skill describes itself", () => {
    it("uses the skill's own SKILL.md words, so it cannot over-promise", () => {
      const tracing = findSkill("tracing");
      const onDisk = fs.readFileSync(
        path.join(REPO_ROOT, "skills/_compiled/native/tracing/SKILL.md"),
        "utf8",
      );

      expect(tracing?.summary).toBeTruthy();
      // The copy in the palette IS the copy in the skill file (and therefore the
      // copy on the public skill directory) — not something we wrote about it.
      expect(onDisk).toContain(tracing!.summary);
    });
  });

  describe("when a platform feature has a real skill behind it", () => {
    it("is not offered twice", () => {
      const labels = LANGY_SKILLS.map((skill) => skill.label.toLowerCase());
      const duplicated = labels.filter(
        (label, index) => labels.indexOf(label) !== index,
      );

      expect(duplicated).toEqual([]);
      // The `datasets` skill supersedes the `library.datasets` CLI feature.
      expect(findSkill("datasets")?.source).toBe("agent-skill");
      expect(findSkill("library.datasets")).toBeUndefined();
    });
  });
});
