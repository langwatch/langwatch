import { ToastProvider } from "@langwatch/design-system-internal";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubDaemon } from "../../__fixtures__/daemon-fetch.ts";
import { MachineSettingsPanel } from "../machine-settings-panel.tsx";

const settings = {
  settings: [
    {
      name: "observability",
      kind: "switch",
      value: "on",
      default: "on",
      summary: "run the observability stack",
    },
    {
      name: "runtime-auto-stop",
      kind: "switch",
      value: "off",
      default: "off",
      summary: "stop the VM",
    },
    {
      name: "runtime-idle-grace-minutes",
      kind: "minutes",
      value: "10",
      default: "10",
      summary: "grace",
    },
  ],
};

const serve = () =>
  stubDaemon({
    answer: ({ method, path }) => {
      if (method === "PUT") return { body: { message: "saved" } };
      return path === "/api/machine-settings" ? { body: settings } : undefined;
    },
  });

const renderPanel = () =>
  render(
    <ToastProvider>
      <MachineSettingsPanel />
    </ToastProvider>,
  );

describe("the machine settings panel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario "Switching observability off stops the stack" */
  it("switches observability off from the hub", async () => {
    const { calls } = serve();
    renderPanel();

    const group = await screen.findByRole("radiogroup", { name: "Observability stack" });
    fireEvent.click(within(group).getByRole("radio", { name: "Off" }));

    await screen.findByText("Saved Observability stack");
    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      { method: "PUT", path: "/api/machine-settings/observability", body: { value: "off" } },
    ]);
  });

  it("turns the idle VM auto-stop on and saves a new grace", async () => {
    const { calls } = serve();
    renderPanel();

    const group = await screen.findByRole("radiogroup", { name: "Stop the VM when idle" });
    fireEvent.click(within(group).getByRole("radio", { name: "On" }));
    await screen.findByText("Saved Stop the VM when idle");

    const input = screen.getByRole("spinbutton", { name: "Idle grace before the VM stops" });
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved Idle grace before the VM stops");

    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      { method: "PUT", path: "/api/machine-settings/runtime-auto-stop", body: { value: "on" } },
      {
        method: "PUT",
        path: "/api/machine-settings/runtime-idle-grace-minutes",
        body: { value: "5" },
      },
    ]);
  });

  it("shows nothing when the daemon has no machine settings", async () => {
    stubDaemon({ answer: () => undefined });
    const { container } = renderPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe("");
  });
});
