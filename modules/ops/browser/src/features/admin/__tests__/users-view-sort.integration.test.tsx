/**
 * @vitest-environment jsdom
 * @see modules/ops/specs/admin-user-sort.feature
 */
import { screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import type { ListParams } from "../behavior/admin-client.ts";
import UsersView from "../ui/sections/users-view.tsx";

const { asked } = vi.hoisted(() => ({ asked: [] as ListParams[] }));

vi.mock("../behavior/admin-client.ts", () => ({ impersonateUser: vi.fn() }));
vi.mock("../behavior/use-admin-resource.ts", () => ({
  useAdminList: (_resource: string, params: ListParams) => {
    asked.push(params);
    return { data: { total: 0, data: [] }, isLoading: false, isFetching: false, error: null };
  },
  useAdminUpdate: () => ({ mutate: vi.fn(), isPending: false }),
}));

const lastSort = () => asked.at(-1)?.sort;
const columnHeader = (name: string) =>
  screen.getAllByRole("columnheader").find((cell) => within(cell).queryByRole("button", { name }))!;

describe("Feature: Sorting the Admin users list", () => {
  beforeEach(() => {
    asked.length = 0;
  });

  /** @scenario "Clicking a column header sorts the users table" */
  it("cycles a header through ascending, descending and the default order, in the address", async () => {
    const host = fakeOpsHost({ isOpsAdmin: true });
    const testingUser = userEvent.setup();
    renderWithOpsHost(<UsersView />, { host });

    expect(lastSort()).toEqual({ field: "createdAt", order: "DESC" });
    for (const name of [
      "ID",
      "Name",
      "Email",
      "Organizations",
      "Projects",
      "Created",
      "Last login",
      "Status",
    ]) {
      expect(columnHeader(name)).toHaveAttribute("aria-sort", "none");
    }

    await testingUser.click(screen.getByRole("button", { name: "Projects" }));
    expect(lastSort()).toEqual({ field: "projects", order: "ASC" });
    expect(columnHeader("Projects")).toHaveAttribute("aria-sort", "ascending");
    expect(host.recording.queries.at(-1)?.next).toMatchObject({ sort: "projects", order: "asc" });

    await testingUser.click(screen.getByRole("button", { name: "Projects" }));
    expect(lastSort()).toEqual({ field: "projects", order: "DESC" });
    expect(columnHeader("Projects")).toHaveAttribute("aria-sort", "descending");

    await testingUser.click(screen.getByRole("button", { name: "Projects" }));
    expect(lastSort()).toEqual({ field: "createdAt", order: "DESC" });
    expect(columnHeader("Projects")).toHaveAttribute("aria-sort", "none");
    expect(host.recording.queries.at(-1)?.next).not.toHaveProperty("sort");
  });

  it("opens on the order the address states, so a reload keeps it", () => {
    renderWithOpsHost(<UsersView />, {
      host: fakeOpsHost({ isOpsAdmin: true, query: { sort: "lastLoginAt", order: "desc" } }),
    });

    expect(lastSort()).toEqual({ field: "lastLoginAt", order: "DESC" });
    expect(columnHeader("Last login")).toHaveAttribute("aria-sort", "descending");
  });

  it("ignores a sort the address names that is not a column", () => {
    renderWithOpsHost(<UsersView />, {
      host: fakeOpsHost({ isOpsAdmin: true, query: { sort: "passwordHash", order: "asc" } }),
    });

    expect(lastSort()).toEqual({ field: "createdAt", order: "DESC" });
  });
});
