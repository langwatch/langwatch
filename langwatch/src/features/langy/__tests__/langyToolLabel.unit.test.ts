import { describe, expect, it } from "vitest";
import {
  describeToolCall,
  effectiveToolName,
  skillCardDetail,
} from "../logic/langyToolLabel";

/**
 * The frames in this file are the ones that were ON SCREEN in the screenshot
 * that failed review — a `skill` call that rendered "SKILL / Skill", and a
 * `bash` call running a LangWatch search that rendered "BASH / Coding…".
 *
 * They are pinned here because both faults had already been reported once and
 * came back. A card gallery cannot catch this class of bug: it renders fixtures
 * we wrote, and our fixtures were more flattering than the real stream.
 */
describe("given a tool frame from the live stream", () => {
  describe("when the agent invokes a skill", () => {
    it("names the skill and says what it is for", () => {
      const label = describeToolCall({
        name: "skill",
        input: { name: "github" },
      });

      expect(label.title).toBe("Using the GitHub skill");
      // Straight off the derived catalogue, which reads the real SKILL.md.
      expect(label.detail).toContain("pull request");
      // The regression: it must never be the tool's own name.
      expect(label.title).not.toBe("Skill");
    });

    // The worker ships 14 skills, not 1. The catalogue used to know about `github`
    // alone, so a `tracing` call fell through to the unnamed fallback.
    it("names the native skills too, in their own words", () => {
      const label = describeToolCall({
        name: "skill",
        input: { name: "tracing" },
      });

      expect(label.title).toBe("Using the Tracing skill");
      expect(label.detail).toContain("LangWatch tracing");
    });

    it("calls a recipe a recipe", () => {
      const label = describeToolCall({
        name: "skill",
        input: { name: "generate-rag-dataset" },
      });

      expect(label.title).toBe("Using the Generate RAG dataset recipe");
      expect(label.title).not.toContain("skill");
    });
  });

  describe("when the agent shells out to the LangWatch CLI", () => {
    const command = "langwatch trace search --format json";

    it("is treated as the capability it is, not as a shell call", () => {
      expect(effectiveToolName("bash", { command })).toBe(
        "langwatch.trace.search",
      );
    });

    it("says what it is searching, never 'Coding'", () => {
      const label = describeToolCall({ name: "bash", input: { command } });

      expect(label.title).toBe("Searching traces");
      expect(label.title).not.toBe("Coding");
      expect(label.detail).toBe(command);
    });

    it("still resolves through a pipe", () => {
      const label = describeToolCall({
        name: "bash",
        input: { command: "langwatch trace search --format json | jq ." },
      });

      expect(label.title).toBe("Searching traces");
    });
  });

  describe("when the agent runs a GitHub step", () => {
    it("names the step, from the command itself", () => {
      const label = describeToolCall({
        name: "bash",
        input: { command: "git push -u origin HEAD" },
      });

      expect(label.title).toBe("Pushing the branch");
    });
  });

  describe("when the agent runs a shell command we do not recognise", () => {
    it("shows the command rather than guessing at an activity", () => {
      const label = describeToolCall({
        name: "bash",
        input: { command: "pnpm test:unit src/foo" },
      });

      // Honest: we don't know what it's for, so we don't invent a verb for it.
      expect(label.title).toBe("Running a command");
      expect(label.detail).toBe("pnpm test:unit src/foo");
    });
  });

  describe("when the agent touches a file", () => {
    it("names the act and the file, not the tool", () => {
      const label = describeToolCall({
        name: "edit",
        input: { file_path: "/repo/src/agents/router.ts" },
      });

      expect(label.title).toBe("Editing a file");
      expect(label.detail).toBe("router.ts");
    });
  });
});

describe("skillCardDetail", () => {
  describe("given a multi-sentence skill description", () => {
    it("keeps the first sentence only", () => {
      expect(
        skillCardDetail(
          "Deep-dive diagnosis of how your AI agent behaves in production. Explores LangWatch analytics and traces end to end. Use when you want to truly understand what your agent is doing in production.",
        ),
      ).toBe("Deep-dive diagnosis of how your AI agent behaves in production.");
    });
  });

  describe("given a description that is only routing guidance for the model", () => {
    it("gives the card no detail at all, rather than instructing the user", () => {
      expect(
        skillCardDetail("Use when you want to understand your agent."),
      ).toBeUndefined();
    });
  });

  describe("given a single-sentence description", () => {
    it("keeps it whole", () => {
      expect(skillCardDetail("Opens a real pull request.")).toBe(
        "Opens a real pull request.",
      );
    });
  });

  describe("given an empty description", () => {
    it("leaves the card with just its title", () => {
      expect(skillCardDetail("   ")).toBeUndefined();
    });
  });
});
