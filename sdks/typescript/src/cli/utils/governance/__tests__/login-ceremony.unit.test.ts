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

  // Parse the command token right after "$ langwatch" instead of scanning
  // the whole line: formatLoginCeremony appends the displayName after the
  // command, so substring checks could match a label ("... # langwatch open
  // helper") and hide a missing or extra wrapper.
  const getCommandSlug = (line: string): string | undefined =>
    /^ {2}\$ langwatch (\S+)/.exec(line)?.[1];
  const isToolCommand = (line: string): boolean => {
    const slug = getCommandSlug(line);
    return slug !== undefined && slug !== "open";
  };

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
        const toolLines = lines.filter(isToolCommand);
        expect(toolLines).toHaveLength(2);
        expect(toolLines[0]).toBe("  $ langwatch claude  # Claude Code");
        expect(toolLines[1]).toBe("  $ langwatch codex   # Codex");
      });
    });

    describe("when the org publishes no tools", () => {
      it("falls back to every built-in wrapper (all seven tools)", () => {
        const lines = formatLoginCeremony(baseInput);
        const toolLines = lines.filter(isToolCommand);
        expect(toolLines).toHaveLength(7);
        for (const slug of [
          "claude",
          "codex",
          "copilot",
          "code",
          "cursor",
          "gemini",
          "opencode",
        ]) {
          expect(toolLines.some((line) => getCommandSlug(line) === slug)).toBe(
            true,
          );
        }
      });

      it("falls back when an empty tools array is supplied", () => {
        const lines = formatLoginCeremony({ ...baseInput, tools: [] });
        const toolLines = lines.filter(isToolCommand);
        expect(toolLines).toHaveLength(7);
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

  describe("when the server predates the overview and sends only the collapsed budget", () => {
    /** @scenario "The login epilogue falls back to the legacy single line on a server without the overview" */
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

  describe("budget overview lines (per-budget, labelled)", () => {
    const orgBudget = {
      spentUsd: 2.43,
      limitUsd: 100,
      window: "MONTH",
      scopePhrase: "whole organization budget",
      resetsAt: "2026-08-01T00:00:00.000Z",
    };
    const personalBudget = {
      spentUsd: 0.1,
      limitUsd: 25,
      window: "MONTH",
      scopePhrase: "personal budget",
      resetsAt: "2026-08-01T00:00:00.000Z",
    };
    const deptBudget = {
      spentUsd: 5,
      limitUsd: 50,
      window: "WEEK",
      scopePhrase: "department budget (Engineering)",
      resetsAt: "2026-08-03T00:00:00.000Z",
    };

    // The ceremony is handed an empty list for two different server
    // answers: gateway access denied, and access granted with no budget
    // bound. Both must render nothing, so both are covered here.
    describe("when the organization gives the member no gateway access", () => {
      /** @scenario "The login epilogue renders nothing without gateway access" */
      it("renders no budget section at all", () => {
        const lines = formatLoginCeremony({ ...baseInput, budgets: [] });
        expect(lines).not.toContain("Budgets that apply to your key:");
        expect(
          lines.find((l) => l.includes("budget")),
        ).toBeUndefined();
      });

      it("suppresses the legacy collapsed line even when also supplied", () => {
        // gatewayAccess=false and zero-budget cases both arrive as an
        // empty list; the unlabeled legacy number must not resurface.
        const lines = formatLoginCeremony({
          ...baseInput,
          budget: { period: "monthly", limitUsd: 100, usedUsd: 2.43 },
          budgets: [],
        });
        expect(
          lines.find((l) => l.startsWith("Monthly budget:")),
        ).toBeUndefined();
      });
    });

    describe("when one budget applies", () => {
      /** @scenario "The login epilogue names each budget that applies to the key" */
      it("renders it with its scope phrase and reset day", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          budgets: [orgBudget],
        });
        expect(lines).toContain("Budgets that apply to your key:");
        expect(lines).toContain(
          "  $2.43 used of $100.00 this month (whole organization budget), resets Aug 1",
        );
      });

      it("appends the provider filter when the budget counts one provider", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          budgets: [{ ...orgBudget, providerLabel: "OpenAI" }],
        });
        expect(lines).toContain(
          "  $2.43 used of $100.00 this month (whole organization budget, OpenAI only), resets Aug 1",
        );
      });

      it("omits the reset suffix for TOTAL windows", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          budgets: [
            {
              spentUsd: 1,
              limitUsd: 10,
              window: "TOTAL",
              scopePhrase: "personal budget",
              resetsAt: null,
            },
          ],
        });
        expect(lines).toContain(
          "  $1.00 used of $10.00 all time (personal budget)",
        );
      });
    });

    describe("when three budgets apply", () => {
      it("renders all three, one line each", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          budgets: [personalBudget, deptBudget, orgBudget],
        });
        const budgetLines = lines.filter((l) => l.includes(" used of "));
        expect(budgetLines).toHaveLength(3);
        expect(budgetLines[0]).toContain("(personal budget)");
        expect(budgetLines[1]).toContain(
          "(department budget (Engineering))",
        );
        expect(budgetLines[2]).toContain("(whole organization budget)");
      });
    });

    describe("when five budgets apply", () => {
      /** @scenario "The login epilogue caps at three budgets and links the rest" */
      it("caps at three lines and links to the budgets page for the rest", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          budgets: [
            personalBudget,
            deptBudget,
            orgBudget,
            { ...orgBudget, scopePhrase: "team budget (Core)" },
            { ...orgBudget, scopePhrase: "project budget (Demo)" },
          ],
          budgetsUrl: "https://app.langwatch.ai/settings/gateway/budgets",
        });
        const budgetLines = lines.filter((l) => l.includes(" used of "));
        expect(budgetLines).toHaveLength(3);
        expect(lines).toContain(
          "  ...and 2 more: https://app.langwatch.ai/settings/gateway/budgets",
        );
      });
    });

    describe("when the overview supersedes the legacy line", () => {
      /** @scenario "The labelled budget lines replace the legacy single line" */
      it("renders the labelled lines, not the collapsed number", () => {
        const lines = formatLoginCeremony({
          ...baseInput,
          budget: { period: "monthly", limitUsd: 100, usedUsd: 2.43 },
          budgets: [orgBudget],
        });
        expect(
          lines.find((l) => l.startsWith("Monthly budget:")),
        ).toBeUndefined();
        expect(lines).toContain(
          "  $2.43 used of $100.00 this month (whole organization budget), resets Aug 1",
        );
      });
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
