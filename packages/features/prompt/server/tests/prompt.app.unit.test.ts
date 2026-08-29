/**
 * @vitest-environment node
 *
 * `PromptApp.applySourceToCopy` — the single description of what a copy
 * receives from its source.
 *
 * The rule matters because the two doors that used to spell it out had already
 * stopped agreeing: `pushToCopies` forwarded the source's `responseFormat` and
 * `syncFromSource` silently dropped it, so a prompt brought up to date by a
 * push and the same prompt brought up to date by a sync did not end up the
 * same. Both paths call this one method now, and it forwards `responseFormat`.
 *
 * No transport here: the copy rule is the application's, and both doors reach
 * it through the same argument list.
 */
import type {
  PromptService,
  UpdatePromptCommand,
  VersionedPrompt,
} from "@langwatch/prompt-contract";
import { describe, expect, it, vi } from "vitest";

import { PromptApp } from "../src/app/prompt.app";

const NOW = new Date("2026-08-24T00:00:00.000Z");

/**
 * A source prompt as the library reads it back. Only the fields the copy rule
 * looks at carry meaning; the rest are the schema's required ones.
 */
function sourcePrompt(overrides: Partial<VersionedPrompt> = {}): VersionedPrompt {
  return {
    id: "prompt-source",
    name: "Support triage",
    handle: "support-triage",
    scope: "PROJECT",
    version: 7,
    versionId: "version-7",
    versionCreatedAt: NOW,
    model: "openai/gpt-5-mini",
    prompt: "You are a support bot.",
    projectId: "project-source",
    organizationId: "org-1",
    messages: [{ role: "user", content: "{{question}}" }],
    authorId: "user-source",
    inputs: [{ identifier: "question", type: "str" }],
    outputs: [{ identifier: "answer", type: "str" }],
    updatedAt: NOW,
    createdAt: NOW,
    tags: [],
    parameters: {},
    ...overrides,
  };
}

function harness() {
  const updated = sourcePrompt({ id: "prompt-copy", projectId: "project-copy" });
  const updatePrompt = vi.fn<(input: UpdatePromptCommand) => Promise<VersionedPrompt>>(
    async () => updated,
  );

  // Only `updatePrompt` is reached: the copy rule reads its source from the
  // argument it was given rather than looking one up. A reach for any other
  // method throws on the missing property, which is the loud failure we want.
  const prompts: Partial<PromptService> = { updatePrompt };

  const app = PromptApp.create({
    prompts: prompts as PromptService,
    projects: { getOrganizationId: async () => "org-1" },
  });

  const apply = (source: VersionedPrompt) =>
    app.applySourceToCopy(
      {
        source,
        targetIdOrHandle: "prompt-copy",
        targetProjectId: "project-copy",
        commitMessage: 'Updated from source prompt "support-triage"',
      },
      { id: "user-asking" },
    );

  const writtenData = (index = 0): UpdatePromptCommand["data"] => {
    const call = updatePrompt.mock.calls[index]?.[0];
    if (!call) throw new Error("applySourceToCopy did not write to the copy");
    return call.data;
  };

  return { app, apply, updatePrompt, writtenData };
}

describe("PromptApp.applySourceToCopy", () => {
  describe("given a source that declares a response format", () => {
    it("writes the response format onto the copy", async () => {
      const { apply, writtenData } = harness();

      await apply(
        sourcePrompt({
          responseFormat: {
            type: "json_schema",
            json_schema: { name: "answer", schema: { type: "object" } },
          },
        }),
      );

      expect(writtenData().responseFormat).toEqual({
        type: "json_schema",
        json_schema: { name: "answer", schema: { type: "object" } },
      });
    });

    // The pull and the push differ in one thing only — how the act names
    // itself in the copy's history. Everything else a copy receives is this
    // one method, so the field cannot be carried by one path and dropped by
    // the other. That divergence is what this suite exists to keep out.
    it("writes the same content whether the act was a pull or a push", async () => {
      const { app, writtenData } = harness();
      const source = sourcePrompt({
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "verdict", schema: { type: "object" } },
        },
      });
      const target = {
        source,
        targetIdOrHandle: "prompt-copy",
        targetProjectId: "project-copy",
      };
      const by = { id: "user-asking" };

      await app.applySourceToCopy(
        { ...target, commitMessage: PromptApp.commitMessageFor("synced", source) },
        by,
      );
      await app.applySourceToCopy(
        { ...target, commitMessage: PromptApp.commitMessageFor("pushed", source) },
        by,
      );

      const { commitMessage: pulledMessage, ...pulledContent } = writtenData(0);
      const { commitMessage: pushedMessage, ...pushedContent } = writtenData(1);

      expect(pulledMessage).not.toBe(pushedMessage);
      expect(pulledContent).toEqual(pushedContent);
      expect(pulledContent.responseFormat).toEqual({
        type: "json_schema",
        json_schema: { name: "verdict", schema: { type: "object" } },
      });
    });
  });

  describe("given a source that declares no response format", () => {
    it("does not write the key at all, so the copy's own value survives", async () => {
      const { apply, writtenData } = harness();

      await apply(sourcePrompt());

      expect(writtenData()).not.toHaveProperty("responseFormat");
    });
  });

  describe("given a source that set none of the optional sampling parameters", () => {
    it("omits every one of them rather than writing an explicit undefined", async () => {
      const { apply, writtenData } = harness();

      await apply(sourcePrompt());

      const data = writtenData();
      for (const field of [
        "maxTokens",
        "topP",
        "frequencyPenalty",
        "presencePenalty",
        "seed",
        "topK",
        "minP",
        "repetitionPenalty",
        "reasoning",
        "verbosity",
        "promptingTechnique",
      ]) {
        expect(data, `${field} must be absent, not present and undefined`).not.toHaveProperty(
          field,
        );
      }
    });
  });

  describe("given a source that set the optional sampling parameters", () => {
    it("carries each of them onto the copy", async () => {
      const { apply, writtenData } = harness();

      await apply(
        sourcePrompt({
          maxTokens: 512,
          topP: 0.9,
          frequencyPenalty: 0.1,
          presencePenalty: 0.2,
          seed: 42,
          topK: 5,
          minP: 0.05,
          repetitionPenalty: 1.1,
          reasoning: "medium",
          verbosity: "low",
          promptingTechnique: { type: "chain_of_thought" },
        }),
      );

      expect(writtenData()).toMatchObject({
        maxTokens: 512,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        seed: 42,
        topK: 5,
        minP: 0.05,
        repetitionPenalty: 1.1,
        reasoning: "medium",
        verbosity: "low",
        promptingTechnique: { type: "chain_of_thought" },
      });
    });
  });

  describe("given a source whose prompt and messages both carry a system message", () => {
    it("hoists the message so the copy is not written a conflicting pair", async () => {
      const { apply, writtenData } = harness();

      await apply(
        sourcePrompt({
          prompt: "stale prompt column",
          messages: [
            { role: "system", content: "authoritative system message" },
            { role: "user", content: "{{question}}" },
          ],
        }),
      );

      const data = writtenData();
      expect(data.prompt).toBe("authoritative system message");
      expect(data.messages).toEqual([{ role: "user", content: "{{question}}" }]);
    });
  });

  describe("given a caller", () => {
    it("attributes the copy's new version to them and not to the source's author", async () => {
      const { apply, writtenData } = harness();

      await apply(sourcePrompt({ authorId: "user-source" }));

      expect(writtenData().authorId).toBe("user-asking");
    });
  });

  describe("when the copy is named", () => {
    it("writes to the target prompt in the target project, not the source's", async () => {
      const { apply, updatePrompt } = harness();

      await apply(sourcePrompt());

      expect(updatePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          idOrHandle: "prompt-copy",
          projectId: "project-copy",
        }),
      );
    });
  });
});

describe("PromptApp.commitMessageFor", () => {
  describe("given a source that has a handle", () => {
    it("names the source by its handle for a pull", () => {
      expect(
        PromptApp.commitMessageFor("synced", { id: "prompt-source", handle: "support-triage" }),
      ).toBe('Updated from source prompt "support-triage"');
    });

    it("names the source by its handle for a push", () => {
      expect(
        PromptApp.commitMessageFor("pushed", { id: "prompt-source", handle: "support-triage" }),
      ).toBe('Pushed from source prompt "support-triage"');
    });
  });

  describe("given a source that has no handle", () => {
    it("falls back to the source's id", () => {
      expect(PromptApp.commitMessageFor("synced", { id: "prompt-source", handle: null })).toBe(
        'Updated from source prompt "prompt-source"',
      );
    });
  });
});
