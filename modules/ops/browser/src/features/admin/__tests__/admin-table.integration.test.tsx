/**
 * @vitest-environment jsdom
 */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminTable } from "../ui/blocks/admin-table.tsx";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

describe("AdminTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps search controlled and reports pagination changes", async () => {
    const onSearchChange = vi.fn();
    const onPageChange = vi.fn();

    render(
      <AdminTable
        title="Users"
        searchValue="alice"
        onSearchChange={onSearchChange}
        pagination={{ page: 2, perPage: 25, total: 60, onPageChange }}
      >
        <div>rows</div>
      </AdminTable>,
      { wrapper },
    );

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));

    expect(onSearchChange).toHaveBeenCalledWith("alice@example.com");
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(1));
    expect(screen.getByText("60 users · showing 26–50")).not.toBeNull();
  });

  it("renders the app-provided error slot without rendering table children", () => {
    render(
      <AdminTable
        title="Organizations"
        searchValue=""
        onSearchChange={() => void 0}
        error={new Error("failed")}
        errorContent={<div>handled failure</div>}
      >
        <div>rows</div>
      </AdminTable>,
      { wrapper },
    );

    expect(screen.getByText("handled failure")).not.toBeNull();
    expect(screen.queryByText("rows")).toBeNull();
  });
});
