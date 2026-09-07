/**
 * @vitest-environment jsdom
 *
 * The section rail's product-shell seam: sections whose pages the
 * product sidebar already lists (Gateway, Governance) stand their rail
 * down. Sections with page-local rails (Automations) keep it.
 *
 * Spec: specs/navigation/shared-section-navigation-layout.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/gateway/virtual-keys";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: mockPathname,
    query: {},
    asPath: mockPathname,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: PropsWithChildren) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

import { SectionNavigationLayout } from "../SectionNavigationLayout";

function renderSection(props: Record<string, unknown> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SectionNavigationLayout
        sectionLabel="AI Gateway"
        navigationItems={[
          { label: "Virtual Keys", href: "/gateway/virtual-keys" },
        ]}
        {...props}
      >
        <div data-testid="section-content" />
      </SectionNavigationLayout>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockPathname = "/gateway/virtual-keys";
});

afterEach(() => {
  cleanup();
});

describe("given the section rail", () => {
  describe("when the product sidebar carries the section's pages", () => {
    /** @scenario The rail stands down when the product sidebar carries the pages */
    it("stands the rail down and gives the content the full width", () => {
      renderSection({ standDownRailInProductShell: true });

      expect(
        screen.queryByTestId("section-navigation-layout"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("product-page-frame")).toBeInTheDocument();
      expect(screen.getByTestId("section-content")).toBeInTheDocument();
    });
  });

  describe("when the rail lists page-local destinations", () => {
    /** @scenario A rail of page-local destinations stays */
    it("keeps the rail", () => {
      mockPathname = "/[project]/automations";
      renderSection({ sectionLabel: "Automations" });

      expect(
        screen.getByTestId("section-navigation-layout"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("product-page-frame"),
      ).not.toBeInTheDocument();
    });
  });
});
