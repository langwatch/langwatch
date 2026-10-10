/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchStaleStatus } from "../workbench-stale-status.tsx";

const { showErrorToast } = vi.hoisted(() => ({ showErrorToast: vi.fn() }));
vi.mock("@langwatch/browser-host/errors", () => ({ showErrorToast }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("stale workbench status", () => {
  /** @scenario Reloading a stale workbench requires confirmation */
  it("confirms discarding edits and lets the user cancel", async () => {
    const onReload = vi.fn().mockResolvedValue(void 0);
    const user = userEvent.setup();
    renderWithDesignSystem(<WorkbenchStaleStatus actorLabel="api" isDirty onReload={onReload} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("Out of date")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Out of date" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "This evaluation was updated through the API. Reloading shows the latest version and discards your unsaved edits.",
    );
    expect(onReload).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onReload).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Out of date" }));
    await user.click(screen.getByRole("button", { name: "Reload", exact: true }));
    expect(onReload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  /** @scenario A failed reload can be retried */
  it("keeps the confirmation usable after a failed reload", async () => {
    const error = new Error("offline");
    const onReload = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(void 0);
    const user = userEvent.setup();
    renderWithDesignSystem(<WorkbenchStaleStatus isDirty={false} onReload={onReload} />);
    await user.click(screen.getByRole("button", { name: "Out of date" }));
    expect(screen.getByRole("dialog")).not.toHaveTextContent("discards your unsaved edits");
    await user.click(screen.getByRole("button", { name: "Reload", exact: true }));
    expect(showErrorToast).toHaveBeenCalledWith({
      error,
      fallbackTitle: "Couldn't reload this evaluation",
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reload", exact: true }));
    expect(onReload).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
