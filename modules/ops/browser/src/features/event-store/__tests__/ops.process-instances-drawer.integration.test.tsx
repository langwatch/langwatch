/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("../../../behavior/ops-api.ts", () => ({
  api: { ops: { listProcessInstances: { useQuery: read } } },
}));
import { ProcessInstancesDrawer } from "../ui/sections/process-instances-drawer.tsx";

const instance = {
  processName: "Webhook delivery",
  processKey: "webhook-42",
  projectId: "project-1",
  revision: 1,
  nextWakeAt: null,
  updatedAt: 1700000000000,
  pendingMessages: 0,
  deadMessages: 0,
};
afterEach(cleanup);
beforeEach(() => {
  read.mockReset();
  read.mockReturnValue({
    data: { instances: [instance], total: 26 },
    isPending: false,
    isError: false,
  });
});
describe("process instance list drawer", () => {
  it("opens a focused instance with the keyboard and keeps paging and search reset connected to its query", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderWithDesignSystem(<ProcessInstancesDrawer onClose={() => {}} onOpenInstance={onOpen} />);
    const instanceButton = await screen.findByRole("button", { name: "webhook-42" });
    // Wait for the drawer's autofocus before choosing the row by keyboard.
    await waitFor(() => expect(screen.getByRole("dialog")).toBe(document.activeElement));
    instanceButton.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(instance);
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), {}),
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Search process instances" }), {
      target: { value: "webhook" },
    });
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, search: "webhook" }),
        {},
      ),
    );
  });
  it("does not present a failed query as an empty process", async () => {
    read.mockReturnValue({
      data: void 0,
      isPending: false,
      isError: true,
      error: new Error("unavailable"),
    });
    renderWithDesignSystem(<ProcessInstancesDrawer onClose={() => {}} onOpenInstance={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The process instances could not load",
    );
    expect(screen.queryByText("No instances yet for this process.")).toBeNull();
  });
});
