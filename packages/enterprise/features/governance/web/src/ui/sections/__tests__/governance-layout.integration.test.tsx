/**
 * @vitest-environment jsdom
 *
 * The section rail, and what it lists.
 *
 * The rows used to live in `platform/app/src/features/navigation/sectionNavItems.ts`
 * and were pinned there by `sectionNavParity.integration.test.tsx`. They are the
 * family's own now, so the two scenarios that pinned them come with them: an
 * entry behind a flag exists only while the flag is on, and the order the rows
 * appear in is the order a reader learns the section by.
 *
 * The platform copy of the list stays for the product sidebar, which still
 * renders it. Nothing enforces that the two agree until the sidebar moves too,
 * which is exactly why this file states the expected list in full rather than
 * comparing one list to the other.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing";
import GovernanceLayout from "../governance-layout";

afterEach(cleanup);

function renderRail(enabledFlags: readonly string[]) {
  renderWithGovernanceHost(<GovernanceLayout>page content</GovernanceLayout>, {
    host: fakeGovernanceHost({ enabledFlags }),
  });

  return Array.from(screen.getByTestId("section-navigation-links").querySelectorAll("a")).map(
    (link) => ({ label: link.textContent, href: link.getAttribute("href") }),
  );
}

describe("given the governance section rail", () => {
  describe("when the billed-cost flag is off", () => {
    /** @scenario With the billed-cost flag off, Costs and Billed do not exist */
    it("lists the four always-on destinations and neither cost page", () => {
      expect(renderRail([])).toEqual([
        { label: "Overview", href: "/governance" },
        { label: "Inventory", href: "/governance/inventory" },
        { label: "Anomaly Rules", href: "/governance/anomaly-rules" },
        { label: "People", href: "/governance/people" },
      ]);
    });
  });

  describe("when the billed-cost flag is on", () => {
    /** @scenario With the billed-cost flag on, Costs and Billed appear as placeholders */
    it("lists Costs and Billed between Overview and Inventory", () => {
      expect(renderRail(["release_ui_governance_billed_cost_enabled"])).toEqual([
        { label: "Overview", href: "/governance" },
        { label: "Costs", href: "/governance/costs" },
        { label: "Billed", href: "/governance/billed" },
        { label: "Inventory", href: "/governance/inventory" },
        { label: "Anomaly Rules", href: "/governance/anomaly-rules" },
        { label: "People", href: "/governance/people" },
      ]);
    });
  });

  describe("when a reader clicks a destination", () => {
    it("navigates through the host rather than reloading the document", () => {
      const host = fakeGovernanceHost({ enabledFlags: [] });
      renderWithGovernanceHost(<GovernanceLayout>page content</GovernanceLayout>, { host });

      screen.getByText("Inventory").click();

      expect(host.recording.navigations).toEqual(["/governance/inventory"]);
    });
  });

  describe("when the page renders inside it", () => {
    it("puts the page's own content in the content column", () => {
      renderWithGovernanceHost(<GovernanceLayout>page content</GovernanceLayout>, {
        host: fakeGovernanceHost({ enabledFlags: [] }),
      });

      expect(screen.getByTestId("section-navigation-content").textContent).toBe("page content");
    });
  });
});
