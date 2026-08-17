/**
 * @vitest-environment jsdom
 *
 * The section rail's navigation-v2 seam: sections whose pages the v2
 * product sidebar already lists (Gateway, Governance) stand their rail
 * down inside a v2 shell, sections with page-local rails (Automations)
 * keep it, and legacy mode keeps every rail unchanged.
 *
 * Spec: specs/navigation/shared-section-navigation-layout.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/gateway/virtual-keys";
let mockMode: "legacy" | "product-switcher" = "product-switcher";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: mockPathname,
    query: {},
    asPath: mockPathname,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/features/navigation/useNavigationMode", () => ({
  useNavigationMode: () => ({ status: "ready", mode: mockMode }),
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
  mockMode = "product-switcher";
});

afterEach(() => {
  cleanup();
});

describe("given the section rail inside a navigation-v2 shell", () => {
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
    /** @scenario A rail of page-local destinations stays in the new modes */
    it("keeps the rail in a new mode", () => {
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

  describe("when the device is in legacy mode", () => {
    it("keeps the rail even for sections that stand down in the v2 shells", () => {
      mockMode = "legacy";
      renderSection({ standDownRailInProductShell: true });

      expect(
        screen.getByTestId("section-navigation-layout"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("product-page-frame"),
      ).not.toBeInTheDocument();
    });
  });
});
