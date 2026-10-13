import { ToastProvider } from "@langwatch/design-system-internal";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("groups the limits by area, shows only what applies, and saves a row or the whole page", async () => {
    const { calls } = serve();
    renderPage();

    const input = await screen.findByRole("spinbutton", { name: "Redis max memory" });
    const row = within(screen.getByRole("row", { name: /Redis max memory/ }));
    expect(screen.getByText("Databases")).toBeDefined();
    expect(screen.getByText("Stack features")).toBeDefined();
    expect(screen.getByText("default 512 · 0 or 64–65536")).toBeDefined();
    expect(screen.getByText("haven up", { selector: "code" })).toBeDefined();
    expect(screen.queryByText("default", { selector: ".ds-badge" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use default" })).toBeNull();
    expect(row.queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.change(input, { target: { value: "256" } });
    fireEvent.click(row.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved 1 setting");
    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      { method: "PUT", path: "/api/limits/redis-maxmemory-mb", body: { value: 256 } },
    ]);
  });

  it("saves a 0 to 1 limit when it is toggled", async () => {
    const { calls } = serve();
    renderPage();

    await screen.findByRole("radiogroup", { name: "Mock judge for Instant Evals" });
    expect(screen.queryByRole("spinbutton", { name: "Mock judge for Instant Evals" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "On" }));

    await screen.findByText("Saved 1 setting");
    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      { method: "PUT", path: "/api/limits/instant-eval-mock-judge", body: { value: 1 } },
    ]);
  });

  it("offers Use default only off the default, and it clears the saved value", async () => {
    const saved = { ...report.limits[0], value: 256, source: "settings" };
    const { calls } = stubDaemon({
      answer: ({ method, path }) => {
        if (method === "DELETE") return { body: { message: "cleared" } };
        return path === "/api/limits" ? { body: { ...report, limits: [saved] } } : undefined;
      },
    });
    renderPage();

    await screen.findByText("settings", { selector: ".ds-badge" });
    fireEvent.click(screen.getByRole("button", { name: "Use default" }));

    await screen.findByText("Saved 1 setting");
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/api/limits/redis-maxmemory-mb" },
    ]);
  });

  it("refuses a value outside the bounds before it is sent", async () => {
    serve();
    renderPage();

    const input = await screen.findByRole("spinbutton", { name: "Redis max memory" });
    fireEvent.change(input, { target: { value: "10" } });

    expect(screen.getByText("Use 0 or 64–65536")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
