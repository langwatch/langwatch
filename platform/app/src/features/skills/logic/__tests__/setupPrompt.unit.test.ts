/**
 * The credentials the browser puts above a copied skill.
 *
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { describe, expect, it } from "vitest";
import { credentialsHeader, withCredentials } from "../setupPrompt";

const SKILL = "# Add LangWatch Tracing to Your Code\n\n## Determine Scope";

describe("withCredentials()", () => {
  describe("given no token was minted", () => {
    it("hands over the skill on its own", () => {
      const prompt = withCredentials({ body: SKILL });

      expect(prompt).toBe(SKILL);
      expect(prompt).not.toContain("LANGWATCH_API_KEY");
    });
  });

  describe("given a token was minted", () => {
    /** @scenario The copied prompt leads with the project's keys */
    it("puts the keys above the skill", () => {
      const prompt = withCredentials({
        body: SKILL,
        credentials: {
          apiKey: "sk-lw-abc",
          projectId: "project_1",
          endpoint: "https://langwatch.acme.internal",
        },
      });

      expect(prompt.indexOf("Use these keys to instrument:")).toBe(0);
      expect(prompt).toContain('LANGWATCH_API_KEY="sk-lw-abc"');
      expect(prompt).toContain('LANGWATCH_PROJECT_ID="project_1"');
      expect(prompt).toContain('LANGWATCH_ENDPOINT="https://langwatch.acme.internal"');
      expect(prompt.indexOf(SKILL)).toBeGreaterThan(0);
    });

    it("leaves the endpoint out when the surface does not know it", () => {
      const prompt = withCredentials({
        body: SKILL,
        credentials: { apiKey: "sk-lw-abc", projectId: "project_1" },
      });

      expect(prompt).not.toContain("LANGWATCH_ENDPOINT");
    });
  });
});

describe("credentialsHeader()", () => {
  it("writes the keys as env lines an agent can paste into a .env", () => {
    const header = credentialsHeader({
      apiKey: "sk-lw-abc",
      projectId: "project_1",
    });

    expect(header).toContain('LANGWATCH_API_KEY="sk-lw-abc"');
    expect(header).toContain("```");
  });
});
