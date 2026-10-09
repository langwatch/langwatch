// @vitest-environment jsdom
/**
 * ADR-177: the drawer on an aggregate names the member project the open trace belongs to;
 * the drawer is told the member only on an aggregate, so the chip is absent elsewhere.
 * @see specs/governance/aggregate-project.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { drawer } = vi.hoisted(() => ({
  drawer: { tenantId: null as string | null },
}));

vi.mock("../../../../../../behavior/trace-host.ts", () => ({
  useOptionalTraceHost: () => ({
    projectName: (id: string) => (id === "project_support" ? "Support Bot" : void 0),
  }),
}));

vi.mock("../../../../../../behavior/trace-drawer.ts", () => ({
  useTraceDrawer: (select: (state: typeof drawer) => unknown) => select(drawer),
}));

import { MemberProjectChip } from "../member-project-chip.tsx";

afterEach(() => {
  cleanup();
  drawer.tenantId = null;
});

describe("<MemberProjectChip />", () => {
  describe("when the drawer is open on a member's trace under an aggregate", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("names the member project", () => {
      drawer.tenantId = "project_support";

      renderWithDesignSystem(<MemberProjectChip />);

      expect(screen.getByText("Support Bot")).toBeInTheDocument();
    });
  });

  describe("when the drawer is open on a plain project", () => {
    it("renders nothing", () => {
      const { container } = renderWithDesignSystem(<MemberProjectChip />);

      expect(container).toBeEmptyDOMElement();
    });
  });
});
