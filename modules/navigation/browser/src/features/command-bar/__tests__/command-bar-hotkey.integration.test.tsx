// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { useCommandBar } from "../behavior/command-bar-context.ts";
import { CommandBarProvider } from "../ui/sections/command-bar-provider.tsx";

vi.mock("../../../behavior/use-activity-tracker.ts", () => ({ useActivityTracker: () => {} }));
vi.mock("../ui/sections/command-bar.tsx", () => ({
  CommandBar: () => {
    const { isOpen } = useCommandBar();
    return isOpen ? <dialog open aria-label="Command bar" /> : null;
  },
}));

afterEach(cleanup);

describe("search without a sidebar or top-bar trigger", () => {
  it("opens from a full-screen tool with the global shortcut and closes with Escape", () => {
    render(
      <WithStubNavigationHost
        readings={{
          pathname: "/demo/studio/workflow_1",
          currentUser: { id: "user_1", name: "Ada", email: "ada@example.com", image: null },
        }}
      >
        <CommandBarProvider>
          <main>Full-screen editor</main>
        </CommandBarProvider>
      </WithStubNavigationHost>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", metaKey: true, ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Command bar" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
