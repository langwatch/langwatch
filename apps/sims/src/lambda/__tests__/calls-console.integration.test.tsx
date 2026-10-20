// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CallsConsole } from "../calls-console.tsx";

const summary = {
  id: "2",
  at: "2026-10-10T10:00:00Z",
  function: "langwatch_nlp-p1",
  mode: "stream",
  method: "POST",
  path: "/studio/execute",
  status: 200,
  durationMs: 12.5,
};

const info = {
  stack: "feat-x",
  target: "http://127.0.0.1:45562",
  capacity: 500,
  functions: ["langwatch_nlp-p1"],
  forcedErrors: ["", "throttled", "not-found", "function-error", "service"],
  settings: { forcedError: "" },
};

const json = ({ body, status = 200 }: { body: unknown; status?: number }) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("the lambdasim console", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario "An operator reads an invocation and forces an error from the console" */
  it("opens an invocation's event and answer, and sets the forced error", async () => {
    let settings = info.settings;
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://lambda.test");
      if (url.pathname === "/_sim/api/settings" && init?.method === "PUT") {
        settings = JSON.parse(typeof init.body === "string" ? init.body : "{}");
        return json({ body: settings });
      }
      if (url.pathname === "/_sim/api/info") return json({ body: { ...info, settings } });
      if (url.pathname === "/_sim/api/calls") return json({ body: { calls: [summary] } });
      if (url.pathname === "/_sim/api/calls/2") {
        return json({
          body: { ...summary, request: '{"rawPath":"/studio/execute"}', response: "data: done" },
        });
      }
      return json({ body: { error: "not_found" }, status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<CallsConsole />);

    await waitFor(() => expect(screen.getAllByTestId("call-row")).toHaveLength(1));
    await waitFor(
      () => expect(screen.getByTestId("call-detail").textContent).toContain("data: done"),
      { timeout: 5000 },
    );
    expect(screen.getByTestId("call-detail").textContent).toContain("langwatch_nlp-p1");

    fireEvent.change(screen.getByLabelText("Forced error"), { target: { value: "throttled" } });

    await waitFor(() => expect(settings.forcedError).toBe("throttled"));
    expect(await screen.findByTitle(/Every invoke fails as throttled/u)).toBeTruthy();
  });
});
