/** @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteConfirmationDialog } from "../delete-confirmation-dialog";

afterEach(cleanup);

describe("DeleteConfirmationDialog", () => {
  it("requires the confirmation phrase before deleting", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ChakraProvider value={defaultSystem}>
        <DeleteConfirmationDialog open onClose={onClose} onConfirm={onConfirm} />
      </ChakraProvider>,
    );

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Type 'delete' to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(deleteButton);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
