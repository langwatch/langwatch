/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackofficeTable } from "../src";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("BackofficeTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps search controlled and reports pagination changes", () => {
    const onSearchChange = vi.fn();
    const onPageChange = vi.fn();

    render(
      <BackofficeTable
        title="Users"
        searchValue="alice"
        onSearchChange={onSearchChange}
        pagination={{ page: 2, perPage: 25, total: 60, onPageChange }}
      >
        <div>rows</div>
      </BackofficeTable>,
      { wrapper },
    );

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));

    expect(onSearchChange).toHaveBeenCalledWith("alice@example.com");
    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(screen.getByText("26–50 of 60")).not.toBeNull();
  });

  it("renders the app-provided error slot without rendering table children", () => {
    render(
      <BackofficeTable
        title="Organizations"
        searchValue=""
        onSearchChange={() => void 0}
        error={new Error("failed")}
        errorContent={<div>handled failure</div>}
      >
        <div>rows</div>
      </BackofficeTable>,
      { wrapper },
    );

    expect(screen.getByText("handled failure")).not.toBeNull();
    expect(screen.queryByText("rows")).toBeNull();
  });
});
