import { ToastProvider } from "@langwatch/design-system-internal";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubDaemon } from "../../__fixtures__/daemon-fetch.ts";
import { LimitsPanel } from "../limits-panel.tsx";

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
  ],
};

describe("the machine limits panel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario "The hub reads and edits the machine limits over HTTP" */
  it("shows each limit with its source and saves an edited value with a PUT", async () => {
    const { calls } = stubDaemon({
      answer: ({ method, path }) => {
        if (method === "PUT") return { body: { message: "redis-maxmemory-mb set to 256 MB" } };
        return path === "/api/limits" ? { body: report } : undefined;
      },
    });
    render(
      <ToastProvider>
        <LimitsPanel />
      </ToastProvider>,
    );

    const input = await screen.findByRole("spinbutton", { name: "redis-maxmemory-mb" });
    expect(screen.getByText("default")).toBeDefined();
    expect(screen.getByText(/Applies next `haven up`/)).toBeDefined();

    fireEvent.change(input, { target: { value: "256" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("redis-maxmemory-mb set to 256 MB");
    expect(calls.find((call) => call.method === "PUT")).toEqual({
      method: "PUT",
      path: "/api/limits/redis-maxmemory-mb",
      body: { value: 256 },
    });
  });
});
