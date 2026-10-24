// Spec: modules/trace/specs/braided-spans.feature, "Actions that would act on the owner's data are
// off on a braided span, with a reason": a braided span's prompt is its owner's, kept apart.

import { describe, expect, it } from "vitest";

import { aggregatePromptUsage, type PromptSpan } from "../prompt-usages.ts";

function span({
  spanId,
  promptId,
  owner,
}: {
  spanId: string;
  promptId: string;
  owner?: string;
}): PromptSpan {
  return {
    spanId,
    params: { "langwatch.prompt.id": promptId },
    braid: owner
      ? {
          ownerProjectId: `project_${owner}`,
          ownerName: owner,
          ownerProjectSlug: null,
          canOpenOwner: false,
          matchedConditions: [],
          signedBy: null,
        }
      : null,
  };
}

describe("aggregatePromptUsage", () => {
  describe("when a braided span ran a prompt with the reader's handle", () => {
    const spans = [
      span({ spanId: "s-own", promptId: "checkout:3" }),
      span({ spanId: "s-braided", promptId: "checkout:3", owner: "payments-agent" }),
    ];

    it("keeps the owner's prompt as its own card, naming the owner", () => {
      const usages = aggregatePromptUsage(spans, []);

      expect(usages.map((usage) => [usage.spanIds, usage.ownerName])).toEqual([
        [["s-own"], undefined],
        [["s-braided"], "payments-agent"],
      ]);
    });

    it("matches the trace's own prompt reference only to the reader's prompt", () => {
      const fallback = [
        { handle: "checkout", versionNumber: null, tag: null, variables: null, draft: false },
      ];

      const [first] = aggregatePromptUsage(spans, fallback);

      expect(first?.spanIds).toEqual(["s-own"]);
      expect(first?.ownerName).toBeUndefined();
    });
  });

  describe("when only braided spans ran a prompt", () => {
    it("lists it once per owner", () => {
      const usages = aggregatePromptUsage(
        [
          span({ spanId: "s-1", promptId: "triage:1", owner: "payments-agent" }),
          span({ spanId: "s-2", promptId: "triage:1", owner: "payments-agent" }),
          span({ spanId: "s-3", promptId: "triage:1", owner: "fraud-agent" }),
        ],
        [],
      );

      expect(usages.map((usage) => [usage.ownerName, usage.spanIds])).toEqual([
        ["payments-agent", ["s-1", "s-2"]],
        ["fraud-agent", ["s-3"]],
      ]);
    });
  });
});
