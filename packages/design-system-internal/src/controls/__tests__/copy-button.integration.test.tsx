// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY_FEEDBACK_MS, CopyButton } from "../copy-button.tsx";

const stubClipboard = ({ writeText }: { writeText: (text: string) => Promise<void> }) => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
};

const clickCopy = async ({ name }: { name: string }) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("CopyButton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("when clicked", () => {
    it("writes the value to the clipboard and names itself Copied", async () => {
      const writeText = vi.fn((_text: string) => Promise.resolve());
      stubClipboard({ writeText });
      render(<CopyButton value="app.main.langwatch.localhost" label="Copy hostname" />);

      await clickCopy({ name: "Copy hostname" });

      expect(writeText).toHaveBeenCalledWith("app.main.langwatch.localhost");
      expect(screen.getByRole("status").textContent).toBe("Copied");
      expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Copied");
    });

    it("returns to its idle name once the feedback window passes", async () => {
      stubClipboard({ writeText: () => Promise.resolve() });
      render(<CopyButton value="5560" label="Copy port" />);

      await clickCopy({ name: "Copy port" });
      act(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_MS);
      });

      expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Copy port");
    });
  });

  describe("when the clipboard refuses", () => {
    it("names itself Copy failed", async () => {
      stubClipboard({ writeText: () => Promise.reject(new Error("denied")) });
      render(<CopyButton value="secret-free" />);

      await clickCopy({ name: "Copy" });

      expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Copy failed");
    });
  });
});
