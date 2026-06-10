/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { BudgetExceededBanner } from "../BudgetExceededBanner";

function renderBanner(
  overrides: Partial<React.ComponentProps<typeof BudgetExceededBanner>> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <BudgetExceededBanner
        spentUsd={500}
        limitUsd={500}
        period="monthly"
        scope="user"
        {...overrides}
      />
    </ChakraProvider>,
  );
}

describe("BudgetExceededBanner", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when given a personal scope monthly budget that's hit", () => {
    it("renders the canonical 'Budget limit reached' title and copy", () => {
      renderBanner();

      expect(screen.getByText("Budget limit reached")).toBeInTheDocument();
      // The amounts are inside <strong> tags so the message text is split
      // across nodes — assert against the alert's full textContent instead
      // of using a single getByText regex.
      const alertText = screen.getByRole("alert").textContent ?? "";
      expect(alertText).toMatch(/of your\s+\$500\.00\s+monthly personal budget/i);
    });

    it("uses role=alert + aria-live=assertive so screen readers announce it", () => {
      renderBanner();

      const banner = screen.getByRole("alert");
      expect(banner.getAttribute("aria-live")).toBe("assertive");
    });
  });

  describe("when a request-increase URL is provided", () => {
    it("renders the 'Request increase' link pointing to that URL", () => {
      renderBanner({
        requestIncreaseUrl:
          "https://app.langwatch.example.com/me/configure#budget?req=abc",
      });

      const link = screen.getByRole("link", { name: /request increase/i });
      expect(link.getAttribute("href")).toBe(
        "https://app.langwatch.example.com/me/configure#budget?req=abc",
      );
    });
  });

  describe("when no request-increase URL is provided", () => {
    it("does not render the 'Request increase' link", () => {
      renderBanner({ requestIncreaseUrl: null });

      expect(
        screen.queryByRole("link", { name: /request increase/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when an admin email is provided", () => {
    it("renders the email as a mailto link", () => {
      renderBanner({ adminEmail: "platform-team@acme.com" });

      const link = screen.getByRole("link", {
        name: "platform-team@acme.com",
      });
      expect(link.getAttribute("href")).toBe(
        "mailto:platform-team@acme.com",
      );
    });
  });

  describe("when adminEmail is actually a URL (free-text supportContact)", () => {
    it("renders the URL as a link with target=_blank", () => {
      renderBanner({ adminEmail: "https://acme.test/help" });

      const link = screen.getByRole("link", { name: "https://acme.test/help" });
      expect(link.getAttribute("href")).toBe("https://acme.test/help");
      expect(link.getAttribute("target")).toBe("_blank");
    });
  });

  describe("when adminEmail is plain text (free-text supportContact)", () => {
    it("renders the text without a link", () => {
      renderBanner({ adminEmail: "ping @platform on Slack" });

      expect(screen.getByText("ping @platform on Slack")).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /ping @platform on Slack/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when adminEmail already has a mailto: prefix", () => {
    it("does not double-prefix the href", () => {
      renderBanner({ adminEmail: "mailto:ops@acme.test" });

      const link = screen.getByRole("link", { name: "mailto:ops@acme.test" });
      expect(link.getAttribute("href")).toBe("mailto:ops@acme.test");
    });
  });

  describe("when neither requestIncreaseUrl nor adminEmail is provided", () => {
    it("renders only the title + main message (no CTA row)", () => {
      renderBanner({ requestIncreaseUrl: null, adminEmail: null });

      expect(screen.getByText("Budget limit reached")).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /request increase/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/admin:/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("when scope is virtual_key", () => {
    it("normalizes to 'personal' in the copy (matches CLI wire shape)", () => {
      renderBanner({ scope: "virtual_key" });

      expect(
        screen.getByText(/personal budget/i),
      ).toBeInTheDocument();
    });
  });

  describe("when scope is team", () => {
    it("renders the team scope label in the copy", () => {
      renderBanner({ scope: "team" });

      expect(screen.getByText(/team budget/i)).toBeInTheDocument();
    });
  });

  describe("when period is weekly", () => {
    it("uses the weekly label in the copy", () => {
      renderBanner({ period: "weekly" });

      expect(screen.getByText(/weekly\s+\w+\s+budget/i)).toBeInTheDocument();
    });
  });

  describe("when period is the gateway's root-form (lowercased GatewayBudgetWindow)", () => {
    it.each([
      ["month", /monthly\s+\w+\s+budget/i],
      ["week", /weekly\s+\w+\s+budget/i],
      ["day", /daily\s+\w+\s+budget/i],
      ["hour", /hourly\s+\w+\s+budget/i],
    ])("normalizes %j to adjective form in the copy", (period, pattern) => {
      renderBanner({ period });

      expect(screen.getByText(pattern)).toBeInTheDocument();
    });

    it("never renders the raw 'month X budget' shape (regression guard)", () => {
      renderBanner({ period: "month" });

      const monthlyMatches = screen.queryAllByText(/\bmonthly\s/i);
      expect(monthlyMatches.length).toBeGreaterThan(0);
    });
  });

  describe("when given an unknown period value", () => {
    it("falls back to the raw period string (graceful degradation)", () => {
      renderBanner({ period: "rolling_24h" });

      // Should still render with the raw value, not crash
      expect(screen.getByText(/rolling_24h/)).toBeInTheDocument();
    });
  });

  describe("formatting", () => {
    it("renders amounts as $X.YY (two decimals)", () => {
      renderBanner({ spentUsd: 42.18, limitUsd: 50 });

      expect(screen.getByText(/\$42\.18/)).toBeInTheDocument();
      expect(screen.getByText(/\$50\.00/)).toBeInTheDocument();
    });
  });
});
