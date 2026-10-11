// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LlmConsole } from "../llm-console.tsx";

const call = ({ id, model, mode }: { id: string; model: string; mode: string }) => ({
  id,
  at: "2026-09-30T10:00:00Z",
  path: "/v1/chat/completions",
  dialect: "openai",
  model,
  mode,
  stream: mode === "markov",
  status: 200,
  inputTokens: 12,
  outputTokens: 30,
  latencyMs: 1.4,
});

const calls = [
  call({ id: "2", model: "gpt-5-mini", mode: "markov" }),
  call({ id: "1", model: "langy-echo", mode: "langy" }),
];

const details: Record<string, unknown> = {
  "2": {
    ...calls[0],
    request: { messages: [{ role: "user", content: "Say something." }] },
    response: {
      mode: "markov",
      text: "The model reads the question.",
      calls: null,
      finish: "stop",
    },
  },
  "1": {
    ...calls[1],
    request: { messages: [{ role: "user", content: '/tool search_traces {"query":"x"}' }] },
    response: {
      mode: "langy",
      text: "",
      calls: [{ id: "abc", name: "search_traces", arguments: '{"query":"x"}' }],
      finish: "tool_calls",
    },
  },
};

const json = ({ body, status = 200 }: { body: unknown; status?: number }) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** llmsim's console API as the page calls it; PUT /settings echoes what it was sent. */
const fakeSim = ({ listed = calls }: { listed?: typeof calls } = {}) => {
  let remaining = listed;
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://llm.test");
    if (url.pathname === "/_sim/api/info") {
      return json({
        body: {
          stack: "feat-x",
          models: ["markov-small"],
          capacity: 500,
          settings: { forcedError: 0, seed: "" },
        },
      });
    }
    if (url.pathname === "/_sim/api/calls" && init?.method === "DELETE") {
      remaining = [];
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/_sim/api/calls") return json({ body: { calls: remaining } });
    if (url.pathname.startsWith("/_sim/api/calls/")) {
      return json({ body: details[url.pathname.split("/").pop() ?? ""] });
    }
    if (url.pathname === "/_sim/api/settings" && init?.method === "PUT") {
      return json({ body: JSON.parse(await new Response(init.body).text()) });
    }
    return json({ body: { error: { message: "not found" } }, status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("the llmsim console", () => {
  afterEach(() => {
    cleanup();
    window.location.hash = "";
    vi.unstubAllGlobals();
  });

  it("lists recent calls and opens one's request and reply", async () => {
    fakeSim();
    render(<LlmConsole />);

    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Recent calls" })).getAllByRole("listitem"),
      ).toHaveLength(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId("call-detail").textContent).toContain(
        "The model reads the question.",
      ),
    );

    fireEvent.click(screen.getByText("langy-echo"));

    await waitFor(() =>
      expect(screen.getByTestId("call-detail").textContent).toContain(
        'search_traces({"query":"x"})',
      ),
    );
  });

  it("explains how to produce calls when there are none", async () => {
    fakeSim({ listed: [] });
    render(<LlmConsole />);

    expect(await screen.findByText("No calls yet")).toBeTruthy();
    expect(screen.getByText("haven up +llm")).toBeTruthy();
  });

  it("saves a forced error from the settings tab", async () => {
    const fetch = fakeSim();
    render(<LlmConsole />);

    fireEvent.click(await screen.findByRole("tab", { name: /Settings/u }));
    await screen.findByTestId("settings");
    fireEvent.change(screen.getByLabelText("Forced error"), { target: { value: "429" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/_sim/api/settings",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ forcedError: 429, seed: "" }),
        }),
      ),
    );
  });

  /** @scenario "The console clears and filters recent calls" */
  it("filters calls by model and clears them all", async () => {
    const fetch = fakeSim();
    render(<LlmConsole />);
    const list = await screen.findByRole("list", { name: "Recent calls" }, { timeout: 5000 });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));

    fireEvent.change(screen.getByLabelText("Filter calls"), { target: { value: "langy" } });
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Recent calls" })).getAllByRole("listitem"),
      ).toHaveLength(1),
    );

    fireEvent.change(screen.getByLabelText("Filter calls"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear calls" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/_sim/api/calls", { method: "DELETE" }),
    );
    expect(await screen.findByText("No calls yet")).toBeTruthy();
  });

  /** @scenario "The console sets any 4xx or 5xx forced error and explains per-call overrides" */
  it("offers every common forced error and names the per-call overrides", async () => {
    const fetch = fakeSim();
    render(<LlmConsole />);

    fireEvent.click(await screen.findByRole("tab", { name: /Settings/u }));
    const settings = await screen.findByTestId("settings");
    for (const header of ["X-Llmsim-Seed", "X-Llmsim-Mode", "X-Llmsim-Error", "Model langy-echo"]) {
      expect(within(settings).getByText(header)).toBeTruthy();
    }
    fireEvent.change(screen.getByLabelText("Forced error"), { target: { value: "529" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/_sim/api/settings",
        expect.objectContaining({ body: JSON.stringify({ forcedError: 529, seed: "" }) }),
      ),
    );
  });
});
