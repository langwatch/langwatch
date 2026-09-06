import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { listNativeSkills, renderSkill } from "../_compiler/native.js";

// Backs specs/langy/langy-dogfood-scenarios.feature: the tracing skill is what
// tells Langy how to prove the instrumentation works. A filmed run asked the
// trace search seven times inside a few seconds, saw nothing, and reported its
// own verification as inconclusive, because the skill said to check and said
// nothing about the ingestion the check waits on.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");

function tracingSkill(): string {
  const skill = listNativeSkills(skillsRoot).find((s) => s.slug === "tracing");
  expect(skill, "tracing is a shipped native skill").toBeTruthy();
  return renderSkill(skill!);
}

describe("given the tracing skill", () => {
  describe("when its verification step is read", () => {
    /** @scenario "The tracing skill waits for the trace instead of asking again at once" */
    it("says an empty first answer means the trace has not arrived yet", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain("langwatch trace search");
      expect(rendered).toContain('an empty first answer means "not yet"');
    });

    /** @scenario "The tracing skill waits for the trace instead of asking again at once" */
    it("bounds the retries and says how long to leave between them", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain("up to three times");
      expect(rendered).toContain("twenty seconds apart");
      expect(rendered).toContain("Do not change the command between tries");
    });

    /** @scenario "The tracing skill waits for the trace instead of asking again at once" */
    it("says not to report the change as verified when the wait runs out", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain("do not report the change as verified");
    });
  });
});
