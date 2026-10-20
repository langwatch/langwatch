/**
 * @vitest-environment jsdom
 * The shared ops confirm: a button confirm, a gated typed acknowledgement, and an owning form
 * whose validator Enter and click both reach.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import { ConfirmDialog } from "../ops-confirm-dialog.tsx";

afterEach(cleanup);

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  renderWithOpsHost(
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={onConfirm}
      title="Drop the queue"
      description="This cannot be undone."
      isLoading={false}
      {...props}
    />,
  );
  return { onConfirm, onClose };
}

describe("ConfirmDialog", () => {
  it("keeps the title, description, red Confirm and Cancel", async () => {
    const { onConfirm, onClose } = renderDialog();

    expect(await screen.findByRole("alertdialog", { name: "Drop the queue" })).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onConfirm while a request is in flight", async () => {
    const { onConfirm } = renderDialog({ isLoading: true });

    fireEvent.click(await screen.findByRole("button", { name: /Confirm/ }));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  describe("given a typed acknowledgement that does not match yet", () => {
    function Typed({ onConfirm }: { onConfirm: () => void }) {
      const [typed, setTyped] = useState("");
      return (
        <ConfirmDialog
          open
          onClose={vi.fn()}
          onConfirm={() => typed === "DELETE" && onConfirm()}
          title="Delete the queue"
          description="Type DELETE to confirm."
          isLoading={false}
          disabledReason={typed === "DELETE" ? void 0 : "Type “DELETE” to confirm."}
        >
          <input
            aria-label="Acknowledgement"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </ConfirmDialog>
      );
    }

    it("keeps Confirm unavailable, with its reason, until the phrase matches", async () => {
      const onConfirm = vi.fn();
      renderWithOpsHost(<Typed onConfirm={onConfirm} />);
      const confirm = await screen.findByRole("button", { name: "Confirm" });

      expect(confirm).toBeDisabled();
      expect(screen.getByLabelText("Type “DELETE” to confirm.")).toBeInTheDocument();
      fireEvent.click(confirm);
      expect(onConfirm).not.toHaveBeenCalled();

      await userEvent.setup().type(screen.getByLabelText("Acknowledgement"), "DELETE");
      expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an owning form", () => {
    it("routes Enter and the Confirm click through the same submit handler, once each", async () => {
      const onSubmit = vi.fn();
      const { onConfirm } = renderDialog({
        onSubmit,
        formId: "enroll-form",
        children: <input aria-label="Organization" />,
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Confirm" }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      await user.type(screen.getByLabelText("Organization"), "{Enter}");

      expect(onSubmit).toHaveBeenCalledTimes(2);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(document.querySelectorAll("form")).toHaveLength(1);
      expect(document.querySelector("form")?.id).toBe("enroll-form");
    });

    it("stays enabled while idle, so an invalid submit can show its errors", async () => {
      renderDialog({ onSubmit: vi.fn(), formId: "f" });

      expect(await screen.findByRole("button", { name: "Confirm" })).toBeEnabled();
    });

    it("does not submit while a request is in flight", async () => {
      const onSubmit = vi.fn();
      renderDialog({ onSubmit, formId: "f", isLoading: true });

      fireEvent.click(await screen.findByRole("button", { name: /Confirm/ }));

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("given a form the children own", () => {
    it("submits that form by id and makes no second form", async () => {
      const onSubmitChild = vi.fn((event: { preventDefault: () => void }) =>
        event.preventDefault(),
      );
      const { onConfirm } = renderDialog({
        formId: "child-form",
        children: (
          <form id="child-form" onSubmit={onSubmitChild}>
            <input aria-label="Sample size" />
          </form>
        ),
      });

      fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

      expect(onSubmitChild).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(document.querySelectorAll("form")).toHaveLength(1);
    });
  });
});
