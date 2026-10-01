/** @vitest-environment jsdom */
// The grants table renders the rows it is given and offers row actions to a manager.
// Spec: specs/rbac/roles-and-access-ui.feature

import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GrantsTable } from "../grants-table.tsx";
import { grantRow, renderInChakra } from "./grant-fixtures.tsx";

const noop = () => undefined;

describe("GrantsTable", () => {
  describe("when it has grants", () => {
    /** @scenario The Access tab lists every grant in the organization */
    it("shows one row per grant: who, role, where and until when", () => {
      renderInChakra(
        <GrantsTable
          isLoading={false}
          isError={false}
          canManage
          onChangeRole={noop}
          onRevoke={noop}
          grants={[
            grantRow({ id: "gr-1" }),
            grantRow({
              id: "gr-2",
              principal: { type: "group", id: "g-eng", name: "Engineering" },
              role: { id: "role_ops", name: "Ops", builtIn: false },
              expiresAt: "2026-12-31T23:59:59.000Z",
            }),
            grantRow({
              id: "gr-3",
              principal: { type: "apiKey", id: "k1", name: null },
              status: "expired",
            }),
          ]}
        />,
      );

      const rows = screen.getAllByRole("row").slice(1);
      expect(rows).toHaveLength(3);
      expect(within(rows[0]!).getByText("Sam")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("Viewer")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("Team · Platform")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("No end date")).toBeInTheDocument();
      expect(within(rows[1]!).getByText("Group")).toBeInTheDocument();
      expect(within(rows[1]!).getByText("Ops")).toBeInTheDocument();
      expect(within(rows[2]!).getByText("An API key with no name yet")).toBeInTheDocument();
      expect(within(rows[2]!).getByText("Expired")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/binding/i);
    });

    it("hands the row to the change and revoke actions", async () => {
      const onChangeRole = vi.fn();
      const onRevoke = vi.fn();
      renderInChakra(
        <GrantsTable
          isLoading={false}
          isError={false}
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

  describe("when it has nothing to show", () => {
    it("says so when nobody has been granted a role", () => {
      renderInChakra(
        <GrantsTable
          isLoading={false}
          isError={false}
          canManage
          grants={[]}
          onChangeRole={noop}
          onRevoke={noop}
        />,
      );

      expect(screen.getByText("Nobody has been granted a role here yet.")).toBeInTheDocument();
    });

    it("says so when the read failed", () => {
      renderInChakra(
        <GrantsTable
          isLoading={false}
          isError
          canManage
          grants={[]}
          onChangeRole={noop}
          onRevoke={noop}
        />,
      );

      expect(screen.getByText("Couldn't load who has access.")).toBeInTheDocument();
    });
  });

  describe("given a reader who may not manage", () => {
    it("offers no row actions", () => {
      renderInChakra(
        <GrantsTable
          isLoading={false}
          isError={false}
          canManage={false}
          grants={[grantRow({})]}
          onChangeRole={noop}
          onRevoke={noop}
        />,
      );

      expect(screen.queryByRole("button", { name: "Actions for Sam" })).not.toBeInTheDocument();
    });
  });
});
