import { ToastProvider } from "@langwatch/design-system-internal";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubDaemon } from "../../__fixtures__/daemon-fetch.ts";
import { SettingsPage } from "../settings-page.tsx";

const report = {
  totalRamBytes: 64 * 1024 ** 3,
  cpus: 16,
  limits: [
    {
      name: "redis-maxmemory-mb",
      env: "HAVEN_REDIS_MAXMEMORY_MB",
      unit: "MB",
      value: 512,
      default: 512,
      source: "default",
      min: 64,
      max: 65536,
      allowZero: true,
      applies: "next `haven up`, which runs `config set maxmemory`",
    },
    {
      name: "instant-eval-mock-judge",
      env: "HAVEN_INSTANT_EVAL_MOCK_JUDGE",
      unit: "on",
      value: 0,
      default: 0,
      source: "default",
      min: 0,
      max: 1,
      allowZero: false,
      applies: "when the stack is next brought up",
    },
  ],
};

const serve = () =>
  stubDaemon({
    answer: ({ method, path }) => {
      if (method === "PUT") return { body: { message: "saved" } };
      return path === "/api/limits" ? { body: report } : undefined;
    },
  });

const renderPage = () =>
  render(
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>,
  );

describe("the settings page", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario "The hub reads and edits the machine limits over HTTP" */
  it("groups the limits by area, offers reset only off the default, and saves every change with one Save", async () => {
    const { calls } = serve();
    renderPage();

    const input = await screen.findByRole("spinbutton", { name: "Redis max memory" });
    expect(screen.getByText("Databases")).toBeDefined();
    expect(screen.getByText("Stack features")).toBeDefined();
    expect(screen.getAllByText("default").length).toBeGreaterThan(0);
    expect(screen.getByTitle(/^Applies next `haven up`/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);

    fireEvent.change(input, { target: { value: "256" } });
    fireEvent.click(screen.getByRole("radio", { name: "On" }));
    expect(screen.getAllByRole("button", { name: "Reset" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved 2 settings");
    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      { method: "PUT", path: "/api/limits/redis-maxmemory-mb", body: { value: 256 } },
      { method: "PUT", path: "/api/limits/instant-eval-mock-judge", body: { value: 1 } },
    ]);
  });

  it("refuses a value outside the bounds before it is sent", async () => {
    serve();
    renderPage();

    const input = await screen.findByRole("spinbutton", { name: "Redis max memory" });
    fireEvent.change(input, { target: { value: "10" } });

    expect(screen.getByText("Use 0 or 64 to 65536")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });
});
