/**
 * @vitest-environment jsdom
 *
 * ADR-144: the trace drawer on an aggregate project names the member project
 * the open trace belongs to. The drawer is told the member only on an
 * aggregate, so the chip is absent everywhere else.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { drawer } = vi.hoisted(() => ({
  drawer: { tenantId: null as string | null },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: {
      teams: [{ projects: [{ id: "project_support", name: "Support Bot" }] }],
    },
  }),
}));

vi.mock("../../../../stores/drawerStore", () => ({
  useDrawerStore: (select: (state: typeof drawer) => unknown) => select(drawer),
}));

import { MemberProjectChip } from "../MemberProjectChip";

function renderChip() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemberProjectChip />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  drawer.tenantId = null;
});

describe("<MemberProjectChip />", () => {
  describe("when the drawer is open on a member's trace under an aggregate", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("names the member project", () => {
      drawer.tenantId = "project_support";

      renderChip();

      expect(screen.getByText("Support Bot")).toBeInTheDocument();
    });
  });

  describe("when the drawer is open on a plain project", () => {
    it("renders nothing", () => {
      const { container } = renderChip();

      expect(container).toBeEmptyDOMElement();
    });
  });
});
