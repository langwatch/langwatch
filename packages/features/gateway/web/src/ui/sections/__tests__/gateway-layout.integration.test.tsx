/**
 * @vitest-environment jsdom
 *
 * The section rail, and what it lists.
 *
 * The rows used to live in `platform/app/src/features/navigation/sectionNavItems.ts`
 * and were pinned there by `features/navigation/__tests__/sectionNavParity.integration.test.tsx`,
 * which rendered the platform layout to read the list it handed the shared
 * frame. They are the family's own now, so the scenario that pinned them comes
 * with them, read off the rendered rail rather than off a captured prop.
 *
 * The platform copy of the list stays for the product sidebar, which still
 * renders it. Nothing enforces that the two agree until the sidebar moves too,
 * which is exactly why this file states the expected list in full rather than
 * comparing one list to the other.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import AiGatewayLayout from "../gateway-layout";

afterEach(cleanup);

function railLinks(): HTMLAnchorElement[] {
  return Array.from(screen.getByTestId("section-navigation-links").querySelectorAll("a"));
}

describe("given the AI Gateway section rail", () => {
  describe("when it renders", () => {
    it("lists every gateway destination, in the order a reader learns them", () => {
      renderWithGatewayHost(<AiGatewayLayout>page content</AiGatewayLayout>, {
        host: fakeGatewayHost(),
      });

      expect(
        railLinks().map((link) => ({
          label: link.textContent,
          href: link.getAttribute("href"),
        })),
      ).toEqual([
        { label: "Virtual Keys", href: "/gateway/virtual-keys" },
        { label: "Model Providers", href: "/settings/model-providers" },
        { label: "Budgets", href: "/gateway/budgets" },
        { label: "Routing Policies", href: "/gateway/routing-policies" },
        { label: "Cache Rules", href: "/gateway/cache-rules" },
        { label: "Guardrails", href: "/gateway/guardrails" },
        { label: "Usage", href: "/gateway/usage" },
        { label: "Billing Events", href: "/gateway/billing-events" },
        { label: "Webhooks", href: "/gateway/webhooks" },
      ]);
    });

    /** @scenario "Every gateway entry opens in the tab the reader is in" */
    it("opens every entry in the same tab, with no new-tab marker", () => {
      renderWithGatewayHost(<AiGatewayLayout>page content</AiGatewayLayout>, {
        host: fakeGatewayHost(),
      });

      expect(
        railLinks().filter(
          (link) => link.getAttribute("target") !== null || link.getAttribute("rel") !== null,
        ),
      ).toEqual([]);
    });
  });

  describe("when a reader clicks a destination", () => {
    it("navigates through the host rather than reloading the document", () => {
      const host = fakeGatewayHost();
      renderWithGatewayHost(<AiGatewayLayout>page content</AiGatewayLayout>, { host });

      screen.getByText("Budgets").click();

      expect(host.recording.navigations).toEqual(["/gateway/budgets"]);
    });
  });

  describe("when the page renders inside it", () => {
    it("puts the page's own content in the content column", () => {
      renderWithGatewayHost(<AiGatewayLayout>page content</AiGatewayLayout>, {
        host: fakeGatewayHost(),
      });

      expect(screen.getByTestId("section-navigation-content").textContent).toBe("page content");
    });
  });
});
