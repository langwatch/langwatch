// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIRM_WINDOW_MS, ConfirmButton } from "../confirm-button.tsx";

const renderRestart = () => {
  const onConfirm = vi.fn();
  render(<ConfirmButton label="Restart" onConfirm={onConfirm} />);
  return { onConfirm, button: screen.getByRole("button") };
};

describe("ConfirmButton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("when clicked once", () => {
    it("arms without confirming", () => {
      const { onConfirm, button } = renderRestart();

      fireEvent.click(button);

      expect(button.hasAttribute("data-armed")).toBe(true);
      expect(screen.getByRole("button", { name: "Confirm" })).toBe(button);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when clicked again inside the 3 s window", () => {
    it("confirms once and disarms", () => {
      const { onConfirm, button } = renderRestart();

      fireEvent.click(button);
      act(() => {
        vi.advanceTimersByTime(CONFIRM_WINDOW_MS - 1);
      });
      fireEvent.click(button);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(button.hasAttribute("data-armed")).toBe(false);
    });
  });

  describe("when the 3 s window lapses", () => {
    it("disarms, so the next click only arms again", () => {
      const { onConfirm, button } = renderRestart();

      fireEvent.click(button);
      act(() => {
        vi.advanceTimersByTime(CONFIRM_WINDOW_MS);
      });

      expect(button.hasAttribute("data-armed")).toBe(false);
      expect(screen.getByRole("button", { name: "Restart" })).toBe(button);

      fireEvent.click(button);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when Escape is pressed while armed", () => {
    it("disarms", () => {
      const { button } = renderRestart();

      fireEvent.click(button);
      fireEvent.keyDown(button, { key: "Escape" });

      expect(button.hasAttribute("data-armed")).toBe(false);
    });
  });
});
