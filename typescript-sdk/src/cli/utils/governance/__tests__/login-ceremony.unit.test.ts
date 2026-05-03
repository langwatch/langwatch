import { describe, expect, it } from "vitest";

import {
  formatLoginCeremony,
  type LoginCeremonyInput,
} from "../login-ceremony";

const baseInput: LoginCeremonyInput = {
  email: "jane@acme.com",
  organizationName: "Acme",
};

describe("formatLoginCeremony", () => {
  describe("when only the user email is known", () => {
    it("renders the minimum ceremony — header + try-it + dashboard", () => {
      const lines = formatLoginCeremony({ email: "jane@acme.com" });
      expect(lines[0]).toBe("✓ Logged in as jane@acme.com");
      expect(lines).toContain("Try it:");
      expect(lines).toContain("Or open your dashboard:");
    });

    it("appends the org name to the header when present", () => {
      const lines = formatLoginCeremony(baseInput);
      expect(lines[0]).toBe("✓ Logged in as jane@acme.com @ Acme");
    });
  });

  describe("when providers are supplied", () => {
    it("emits the provider section between the header and the try-it block", () => {
      const lines = formatLoginCeremony({
        ...baseInput,
        providers: [
          { name: "anthropic", modelSummary: "Claude — Sonnet, Haiku" },
          { name: "openai", modelSummary: "GPT-5, GPT-5-mini" },
          { name: "gemini", modelSummary: "2.5 Pro, 2.5 Flash" },
        ],
      });
      expect(lines).toContain("Your AI tools are ready:");
      const providerLines = lines.filter((l) => l.startsWith("  •"));
      expect(providerLines).toHaveLength(3);
      expect(providerLines[0]).toMatch(/anthropic/);
      expect(providerLines[0]).toMatch(/Claude — Sonnet, Haiku/);
    });

    it("aligns provider names by padding to the longest name", () => {
      const lines = formatLoginCeremony({
        ...baseInput,
        providers: [
          { name: "openai", modelSummary: "x" },
          { name: "anthropic", modelSummary: "y" },
        ],
      });
      // "anthropic" is 9 chars; "openai" should be padded to 9 chars too
      const opening = lines.find((l) => l.includes("openai"));
      const anthropicLine = lines.find((l) => l.includes("anthropic"));
      expect(opening).toBeDefined();
      expect(anthropicLine).toBeDefined();
      // Both should have the same width before the model summary
      const openIdx = opening!.indexOf("(x)");
      const anthIdx = anthropicLine!.indexOf("(y)");
      expect(openIdx).toBe(anthIdx);
    });

    it("omits the providers section when the array is empty", () => {
      const lines = formatLoginCeremony({ ...baseInput, providers: [] });
      expect(lines).not.toContain("Your AI tools are ready:");
    });
  });

  describe("when a budget is supplied", () => {
    it("renders the budget line with the storyboard formatting", () => {
      const lines = formatLoginCeremony({
        ...baseInput,
        budget: { period: "monthly", limitUsd: 500, usedUsd: 0 },
      });
      const budgetLine = lines.find((l) => l.startsWith("Monthly budget:"));
      expect(budgetLine).toBe("Monthly budget: $500   |   Used: $0.00");
    });

    it("uses two-decimal formatting for fractional limits", () => {
      const lines = formatLoginCeremony({
        ...baseInput,
        budget: { period: "monthly", limitUsd: 42.5, usedUsd: 13.27 },
      });
      const budgetLine = lines.find((l) => l.startsWith("Monthly budget:"));
      expect(budgetLine).toBe("Monthly budget: $42.50   |   Used: $13.27");
    });

    it("capitalises arbitrary period casing", () => {
      const lines = formatLoginCeremony({
        ...baseInput,
        budget: { period: "WEEKLY", limitUsd: 10, usedUsd: 0 },
      });
      const budgetLine = lines.find((l) => l.startsWith("Weekly budget:"));
      expect(budgetLine).toBeDefined();
    });

    it("omits the budget section when not supplied", () => {
      const lines = formatLoginCeremony(baseInput);
      expect(lines.find((l) => l.startsWith("Monthly budget:"))).toBeUndefined();
    });
  });

  describe("try-it block", () => {
    it("defaults to claude / codex / cursor wrappers", () => {
      const lines = formatLoginCeremony(baseInput);
      const tryLines = lines.filter(
        (l) =>
          l.startsWith("  $ langwatch") && !l.includes("langwatch dashboard"),
      );
      expect(tryLines).toHaveLength(3);
      expect(tryLines.find((l) => l.includes("claude"))).toBeDefined();
      expect(tryLines.find((l) => l.includes("codex"))).toBeDefined();
      expect(tryLines.find((l) => l.includes("cursor"))).toBeDefined();
    });

    it("attaches a label to known wrappers", () => {
      const lines = formatLoginCeremony({ ...baseInput, wrappers: ["claude"] });
      const claudeLine = lines.find((l) => l.includes("langwatch claude"));
      expect(claudeLine).toMatch(/use Claude Code/);
    });

    it("renders unknown wrappers without a label rather than crashing", () => {
      const lines = formatLoginCeremony({
        ...baseInput,
        wrappers: ["new-tool"],
      });
      const line = lines.find((l) => l.includes("langwatch new-tool"));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/#/);
    });
  });

  describe("dashboard hint", () => {
    it("appears by default", () => {
      const lines = formatLoginCeremony(baseInput);
      expect(lines).toContain("Or open your dashboard:");
      expect(lines).toContain("  $ langwatch dashboard");
    });

    it("can be suppressed with dashboardCommand=false", () => {
      const lines = formatLoginCeremony({
        ...baseInput,
        dashboardCommand: false,
      });
      expect(lines).not.toContain("Or open your dashboard:");
    });
  });

  describe("full Storyboard Screen 4 output (golden)", () => {
    it("matches the gateway.md storyboard layout end-to-end", () => {
      const lines = formatLoginCeremony({
        email: "jane@acme.com",
        providers: [
          { name: "anthropic", modelSummary: "Claude — Sonnet, Haiku" },
          { name: "openai", modelSummary: "GPT-5, GPT-5-mini" },
          { name: "gemini", modelSummary: "2.5 Pro, 2.5 Flash" },
        ],
        budget: { period: "monthly", limitUsd: 500, usedUsd: 0 },
      });
      // Golden output assertion — the storyboard ceremony shape
      expect(lines.join("\n")).toBe(
        [
          "✓ Logged in as jane@acme.com",
          "",
          "Your AI tools are ready:",
          "  • anthropic  (Claude — Sonnet, Haiku)",
          "  • openai     (GPT-5, GPT-5-mini)",
          "  • gemini     (2.5 Pro, 2.5 Flash)",
          "",
          "Monthly budget: $500   |   Used: $0.00",
          "",
          "Try it:",
          "  $ langwatch claude  # use Claude Code",
          "  $ langwatch codex   # use Codex",
          "  $ langwatch cursor  # use Cursor",
          "",
          "Or open your dashboard:",
          "  $ langwatch dashboard",
        ].join("\n"),
      );
    });
  });
});
