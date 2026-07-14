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
    it("renders the header, the AI tools block, and the open hint", () => {
      const lines = formatLoginCeremony({ email: "jane@acme.com" });
      expect(lines[0]).toBe("✓ Logged in as jane@acme.com");
      expect(lines).toContain("Your AI tools (run any of these):");
      expect(lines).toContain("Or open the app in your browser:");
    });

    it("appends the org name to the header when present", () => {
      const lines = formatLoginCeremony(baseInput);
      expect(lines[0]).toBe("✓ Logged in as jane@acme.com @ Acme");
    });
  });

  describe("AI tools block", () => {
    describe("when the org publishes coding-assistant tools", () => {
      it("lists exactly those tools as runnable commands with their names", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          tools: [
            { slug: "claude", displayName: "Claude Code" },
            { slug: "codex", displayName: "Codex" },
          ],
        });
        const toolLines = lines.filter(
          (l) => l.startsWith("  $ langwatch") && !l.includes("langwatch open"),
        );
        expect(toolLines).toHaveLength(2);
        expect(toolLines[0]).toBe("  $ langwatch claude  # Claude Code");
        expect(toolLines[1]).toBe("  $ langwatch codex   # Codex");
      });
    });

    describe("when the org publishes no tools", () => {
      it("falls back to the built-in default wrappers", () => {
        const lines = formatLoginCeremony(baseInput);
        const toolLines = lines.filter(
          (l) => l.startsWith("  $ langwatch") && !l.includes("langwatch open"),
        );
        expect(toolLines).toHaveLength(3);
        expect(toolLines.find((l) => l.includes("claude"))).toBeDefined();
        expect(toolLines.find((l) => l.includes("codex"))).toBeDefined();
        expect(toolLines.find((l) => l.includes("cursor"))).toBeDefined();
      });

      it("falls back when an empty tools array is supplied", () => {
        const lines = formatLoginCeremony({ ...baseInput, tools: [] });
        const toolLines = lines.filter(
          (l) => l.startsWith("  $ langwatch") && !l.includes("langwatch open"),
        );
        expect(toolLines).toHaveLength(3);
      });
    });
  });

  describe("model providers block", () => {
    describe("when providers are supplied", () => {
      it("renders providers under a clearly distinct virtual-key heading", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          providers: [
            { name: "anthropic", displayName: "Anthropic", configured: true },
            { name: "openai", displayName: "OpenAI", configured: true },
          ],
        });
        expect(lines).toContain(
          "Model providers you can issue a virtual key for:",
        );
        // NOT labelled "AI tools" — that confusion is the bug being fixed.
        expect(lines).not.toContain("Your AI tools are ready:");
        const providerLines = lines.filter((l) => l.startsWith("  •"));
        expect(providerLines).toHaveLength(2);
        expect(providerLines[0]).toMatch(/anthropic/);
        expect(providerLines[0]).toMatch(/Anthropic/);
      });

      it("annotates an unconfigured provider so the user knows it needs setup", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          providers: [{ name: "openai", configured: false }],
        });
        const providerLine = lines.find((l) => l.startsWith("  •"));
        expect(providerLine).toMatch(/not configured yet/);
      });

      it("aligns provider names by padding to the longest name", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          providers: [
            { name: "openai", displayName: "x" },
            { name: "anthropic", displayName: "y" },
          ],
        });
        const openLine = lines.find((l) => l.includes("openai"));
        const anthropicLine = lines.find((l) => l.includes("anthropic"));
        expect(openLine).toBeDefined();
        expect(anthropicLine).toBeDefined();
        // "anthropic" is 9 chars; "openai" padded to 9 too → labels align.
        expect(openLine!.indexOf("x")).toBe(anthropicLine!.indexOf("y"));
      });

      it("omits the providers section when the array is empty", () => {
        const lines = formatLoginCeremony({ ...baseInput, providers: [] });
        expect(lines).not.toContain(
          "Model providers you can issue a virtual key for:",
        );
      });
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

  describe("open hint", () => {
    it("appears by default", () => {
      const lines = formatLoginCeremony(baseInput);
      expect(lines).toContain("Or open the app in your browser:");
      expect(lines).toContain("  $ langwatch open");
    });

    it("can be suppressed with openCommand=false", () => {
      const lines = formatLoginCeremony({
        ...baseInput,
        openCommand: false,
      });
      expect(lines).not.toContain("Or open the app in your browser:");
    });
  });

  describe("full ceremony output (golden)", () => {
    it("renders the two distinct sections end-to-end", () => {
      const lines = formatLoginCeremony({
        email: "jane@acme.com",
        organizationName: "Acme",
        tools: [{ slug: "claude", displayName: "Claude Code" }],
        providers: [
          { name: "anthropic", displayName: "Anthropic", configured: true },
          { name: "openai", displayName: "OpenAI", configured: false },
        ],
        budget: { period: "monthly", limitUsd: 500, usedUsd: 0 },
      });
      expect(lines.join("\n")).toBe(
        [
          "✓ Logged in as jane@acme.com @ Acme",
          "",
          "Your AI tools (run any of these):",
          "  $ langwatch claude  # Claude Code",
          "",
          "Model providers you can issue a virtual key for:",
          "  • anthropic  Anthropic",
          "  • openai     OpenAI  (not configured yet)",
          "",
          "Monthly budget: $500   |   Used: $0.00",
          "",
          "Or open the app in your browser:",
          "  $ langwatch open",
        ].join("\n"),
      );
    });
  });
});
