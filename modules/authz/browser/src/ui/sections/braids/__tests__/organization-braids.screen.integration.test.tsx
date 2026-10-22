/**
 * @vitest-environment jsdom
 * Spec: modules/authz/specs/braids-screen.feature
 */

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/authz-api.ts", async () => ({
  authzApi: (await import("./braids-api-fake.ts")).braidsFake.api,
}));

// Isolation is off: reload so the screen binds this file's mock, not a sibling suite's.
vi.resetModules();
const { braidsFake, liveBraid, STRUCTURE } = await import("./braids-api-fake.ts");
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../../testing.tsx");
const { default: OrganizationBraidsScreen } = await import("../organization-braids.screen.tsx");

function renderAs({ isEnterprise = true }: { isEnterprise?: boolean } = {}) {
  const host = new FakeAuthzHost({
    scope: { organizationId: "org-1" },
    grants: new Set(["organization:manage"]),
    plan: { isEnterprise, isLoading: false },
    structure: STRUCTURE,
  });
  return renderWithAuthzHost(<OrganizationBraidsScreen />, host);
}

beforeEach(() => {
  braidsFake.state.organization = [
    liveBraid(),
    liveBraid({ braidId: "b-2", ownerProjectId: "p-orch", readerProjectId: "p-spec", where: null }),
  ];
  braidsFake.state.keptToAdmins = false;
  braidsFake.state.setPolicy.mockClear();
});

describe("OrganizationBraidsScreen", () => {
  describe("given an organisation admin", () => {
    /** @scenario An organisation admin chooses who may braid */
    it("An organisation admin chooses who may braid", async () => {
      const { host } = renderAs();
      const rows = screen.getAllByTestId("organization-braid-row");
      expect(rows).toHaveLength(2);
      expect(within(rows[0]!).getByText("specialists")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("orchestrator")).toBeInTheDocument();
      expect(within(rows[1]!).getByText("Every span")).toBeInTheDocument();
      expect(screen.getByText(/project admins can braid their projects/)).toBeInTheDocument();
      const toggle = screen.getByRole("checkbox", { name: "Keep braids to organisation admins" });
      expect(toggle).not.toBeChecked();
      await userEvent.setup().click(toggle);
      expect(braidsFake.state.setPolicy).toHaveBeenCalledWith({
        organizationId: "org-1",
        braidsOrganizationAdminsOnly: true,
      });
      expect(host.successes[0]?.title).toBe("Braids are kept to organisation admins");
    });

    it("Below Enterprise the setting shows the upsell, not a dead control", () => {
      renderAs({ isEnterprise: false });
      expect(screen.getByTestId("braids-policy-upsell")).toHaveTextContent(
        /included in Enterprise/,
      );
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.getByText("Braids are paused")).toBeInTheDocument();
    });
  });
});
