/** @vitest-environment jsdom */
// One holder's grants as a table: each grant's role, scope and end date, with row actions
// offered to a manager only. Spec: specs/rbac/roles-and-access-ui.feature

import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GrantsTable } from "../grants-table.tsx";
import { grantRow, renderInChakra } from "./grant-fixtures.tsx";

const noop = () => undefined;

describe("GrantsTable", () => {
  describe("when a holder has grants", () => {
    /** @scenario The Access tab lists every grant in the organization, under its holder */
    it("shows one row per grant: role, where and until when, an expired one saying so", () => {
      renderInChakra(
        <GrantsTable
          canManage
          onChangeRole={noop}
          onRevoke={noop}
          grants={[
            grantRow({ id: "gr-1" }),
            grantRow({
              id: "gr-2",
              role: { id: "role_ops", name: "Ops", builtIn: false },
              scope: { type: "organization", id: "org-1", name: "Acme" },
              expiresAt: "2099-12-31T12:00:00.000Z",
            }),
            grantRow({ id: "gr-3", status: "expired" }),
          ]}
        />,
      );

      const rows = screen.getAllByTestId("grant-row");
      expect(rows).toHaveLength(3);
      expect(within(rows[0]!).getByText("Viewer")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("Team Platform")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("No end date")).toBeInTheDocument();
      expect(within(rows[1]!).getByText("Ops")).toBeInTheDocument();
      expect(within(rows[1]!).getByText("Organization")).toBeInTheDocument();
      expect(within(rows[1]!).getByText("31 Dec 2099")).toBeInTheDocument();
      expect(within(rows[2]!).getByText("Expired")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/binding/i);
    });

    it("hands the grant to the change and revoke actions", async () => {
      const onChangeRole = vi.fn();
      const onRevoke = vi.fn();
      renderInChakra(
        <GrantsTable
          canManage
          grants={[grantRow({})]}
          onChangeRole={onChangeRole}
          onRevoke={onRevoke}
        />,
      );

      await userEvent.click(screen.getByTestId("grant-row-actions"));
      await userEvent.click(await screen.findByTestId("grant-change-role"));
      expect(onChangeRole).toHaveBeenCalledWith(expect.objectContaining({ id: "gr-1" }));

      fireEvent.click(screen.getByTestId("grant-row-actions"));
      await userEvent.click(await screen.findByTestId("grant-revoke"));
      expect(onRevoke).toHaveBeenCalledWith(expect.objectContaining({ id: "gr-1" }));
    });
  });

  describe("given a reader who may not manage", () => {
    it("offers no row actions", () => {
      renderInChakra(
        <GrantsTable
          canManage={false}
          grants={[grantRow({})]}
          onChangeRole={noop}
          onRevoke={noop}
        />,
      );

      expect(screen.getByTestId("grant-row")).toBeInTheDocument();
      expect(screen.queryByTestId("grant-row-actions")).not.toBeInTheDocument();
    });
  });
});
