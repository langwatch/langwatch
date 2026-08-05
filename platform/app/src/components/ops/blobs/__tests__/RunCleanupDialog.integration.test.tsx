/**
 * @vitest-environment jsdom
 *
 * Renders the real RunCleanupDialog against an actual ChakraProvider. The
 * subject is the typed-confirmation guard: reclaiming deletes payloads
 * irreversibly and silently at the queue level, so the dialog must not be able
 * to fire the sweep on anything less than the exact word.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunCleanupDialog } from "../RunCleanupDialog";

const renderDialog = ({
  value,
  onConfirm = vi.fn(),
  onChange = vi.fn(),
  onClose = vi.fn(),
}: {
  value: string | null;
  onConfirm?: () => void;
  onChange?: (value: string) => void;
  onClose?: () => void;
}) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <RunCleanupDialog
        value={value}
        onChange={onChange}
        onClose={onClose}
        onConfirm={onConfirm}
        isLoading={false}
      />
    </ChakraProvider>,
  );
  return { onConfirm, onChange, onClose };
};

const clickConfirm = () => {
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
};

afterEach(cleanup);

describe("RunCleanupDialog", () => {
  describe("given the dialog has not been opened", () => {
    describe("when it renders", () => {
      it("puts no cleanup prompt on the page at all", () => {
        renderDialog({ value: null });
        expect(screen.queryByText("Run cleanup")).toBeNull();
      });
    });
  });

  describe("given the operator has typed nothing yet", () => {
    describe("when confirm is pressed", () => {
      it("does not run the sweep", () => {
        const { onConfirm } = renderDialog({ value: "" });
        clickConfirm();
        expect(onConfirm).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a partially typed word", () => {
    describe("when confirm is pressed", () => {
      it("does not run the sweep", () => {
        const { onConfirm } = renderDialog({ value: "RECLAI" });
        clickConfirm();
        expect(onConfirm).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the word in the wrong case", () => {
    describe("when confirm is pressed", () => {
      it("does not run the sweep, because the match is exact", () => {
        const { onConfirm } = renderDialog({ value: "reclaim" });
        clickConfirm();
        expect(onConfirm).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the exact word", () => {
    describe("when confirm is pressed", () => {
      it("runs the sweep once", () => {
        const { onConfirm } = renderDialog({ value: "RECLAIM" });
        clickConfirm();
        expect(onConfirm).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the operator types into the confirmation field", () => {
    describe("when a character lands", () => {
      it("reports what was typed back to the owner of the state", () => {
        const { onChange } = renderDialog({ value: "" });
        fireEvent.change(screen.getByLabelText("Type RECLAIM to confirm"), {
          target: { value: "RECL" },
        });
        expect(onChange).toHaveBeenCalledWith("RECL");
      });
    });
  });
});
