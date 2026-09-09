// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which rows a registered tool has.
 *
 * Pinned on its own because it is a claim about a contract rather than about
 * a layout: a Seats row on a tool nobody buys seats for is a promise of a
 * read that will never exist, and a missing Seats row on one that is
 * seat-licensed hides the unassigned seats a renewal turns on.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
import { describe, expect, it } from "vitest";

import {
  applicableRowsForTool,
  badgesForTool,
  billingForTool,
  buildRegisteredToolCards,
  type RegisteredTool,
  vendorForTool,
} from "../registeredTools";

function assistant(assistantKind: string): RegisteredTool {
  return {
    id: `tool-${assistantKind}`,
    displayName: assistantKind,
    type: "coding_assistant",
    enabled: true,
    config: { assistantKind, setupCommand: "langwatch x" },
  };
}

const provider: RegisteredTool = {
  id: "tool-openai",
  displayName: "OpenAI",
  type: "model_provider",
  enabled: true,
  config: { providerKey: "openai" },
};

const internal: RegisteredTool = {
  id: "tool-desk",
  displayName: "Support Desk Assistant",
  type: "external_tool",
  enabled: true,
  config: { descriptionMarkdown: "", linkUrl: "https://example.test" },
};

describe("given a registered tool", () => {
  describe("when it rides each person's own plan", () => {
    /** @scenario "A row that does not apply to a tool is left off its card" */
    it("has subscriptions, and neither seats nor a licence line", () => {
      const rows = applicableRowsForTool(assistant("claude_code"));
      expect(billingForTool(assistant("claude_code"))).toBe("subscription");
      expect(rows).toContain("subscriptions");
      expect(rows).not.toContain("seats");
      expect(rows).not.toContain("licencePerMonth");
      expect(rows).not.toContain("idlePerMonth");
    });

    /** @scenario "A row that does not apply to a tool is left off its card" */
    it("drops the token row, which would repeat the usage figure", () => {
      // The plan fixes the money, so the token count moves nothing a reader
      // could act on. It is the same fact in a second typeface.
      expect(applicableRowsForTool(assistant("codex"))).not.toContain(
        "tokens30Days",
      );
    });

    /** @scenario "A row that does not apply to a tool is left off its card" */
    it("has no agents and no conversation count", () => {
      const rows = applicableRowsForTool(assistant("gemini"));
      expect(rows).not.toContain("agents");
      expect(rows).not.toContain("conversations30Days");
    });
  });

  describe("when the vendor bills an administrator per named seat", () => {
    /** @scenario "A seat-licensed tool carries seats and unassigned licence cost" */
    it("has seats, licence per month and unassigned licence cost", () => {
      for (const kind of ["github_copilot", "cursor"]) {
        expect(billingForTool(assistant(kind))).toBe("seat");
        const rows = applicableRowsForTool(assistant(kind));
        expect(rows).toContain("seats");
        expect(rows).toContain("licencePerMonth");
        expect(rows).toContain("idlePerMonth");
        expect(rows).not.toContain("subscriptions");
      }
    });
  });

  describe("when it is billed on what it consumed", () => {
    /** @scenario "A consumption-billed tool carries the token count it is billed on" */
    it("has the token row and no payment row", () => {
      for (const tool of [provider, assistant("opencode")]) {
        expect(billingForTool(tool)).toBe("consumption");
        const rows = applicableRowsForTool(tool);
        expect(rows).toContain("tokens30Days");
        expect(rows).not.toContain("seats");
        expect(rows).not.toContain("subscriptions");
      }
    });
  });

  describe("when it is a tool the organization built itself", () => {
    /** @scenario "An in-house tool carries its agents and its conversations" */
    it("has agents and conversations and no payment row at all", () => {
      const rows = applicableRowsForTool(internal);
      expect(rows).toContain("agents");
      expect(rows).toContain("conversations30Days");
      expect(rows).not.toContain("seats");
      expect(rows).not.toContain("licencePerMonth");
      expect(rows).not.toContain("subscriptions");
      expect(rows).not.toContain("tokens30Days");
    });
  });

  describe("when the registry does not say how it is paid for", () => {
    /** @scenario "A row that does not apply to a tool is left off its card" */
    it("shows no payment row rather than guessing one", () => {
      const custom = assistant("custom");
      expect(billingForTool(custom)).toBe("unknown");
      const rows = applicableRowsForTool(custom);
      for (const row of [
        "seats",
        "licencePerMonth",
        "idlePerMonth",
        "subscriptions",
        "tokens30Days",
      ] as const) {
        expect(rows).not.toContain(row);
      }
      // A guessed billing model would also earn a badge claiming it.
      expect(badgesForTool(custom)).toEqual([]);
    });
  });

  describe("when every tool is asked what it did", () => {
    /** @scenario "A row that does not apply to a tool is left off its card" */
    it("gives all of them volume and attribution, whatever they cost", () => {
      for (const tool of [
        assistant("claude_code"),
        assistant("github_copilot"),
        provider,
        internal,
      ]) {
        const rows = applicableRowsForTool(tool);
        for (const row of [
          "eventsLast24Hours",
          "usage30Days",
          "attributed",
          "topDepartment",
        ] as const) {
          expect(rows).toContain(row);
        }
      }
    });
  });
});

describe("given the cards built from the registry", () => {
  describe("when they are built", () => {
    /** @scenario "A row nothing measures shows a dash naming what would fill it" */
    it("carries no figure at all, because nothing is measured per tool", () => {
      const cards = buildRegisteredToolCards({
        tools: [assistant("claude_code"), provider, internal],
      });
      for (const card of cards) {
        expect(card.values).toEqual({});
        expect(card.isSample).toBeUndefined();
      }
    });

    /** @scenario "A registered tool is a card carrying its name and its vendor" */
    it("names the vendor a customer would name", () => {
      expect(vendorForTool(assistant("claude_code"))).toBe("Anthropic");
      expect(vendorForTool(assistant("github_copilot"))).toBe("GitHub");
      expect(vendorForTool(provider)).toBe("OpenAI");
      expect(vendorForTool(internal)).toBe("In-house");
      // Not a fabricated vendor for a tool the registry says nothing about.
      expect(vendorForTool(assistant("custom"))).toBe("Vendor not recorded");
    });
  });
});
