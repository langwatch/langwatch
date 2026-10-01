// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CallsConsole } from "../calls-console.tsx";

const turn = ({ index, agentText }: { index: number; agentText: string }) => ({
  index,
  at: "2026-09-30T10:00:05Z",
  callerText: "This is the simulated caller speaking.",
  agentText,
  callerFrames: 16,
  agentFrames: 30,
});

const calls = [
  {
    id: "conv_voicesim_0002",
    agentId: "agent_live",
    startedAt: "2026-09-30T10:01:00Z",
    callerFrames: 3,
    agentFrames: 0,
    turns: null,
    events: [{ at: "2026-09-30T10:01:00Z", direction: "in", type: "connected" }],
    droppedEvents: 0,
  },
  {
    id: "conv_voicesim_0001",
    agentId: "agent_done",
    startedAt: "2026-09-30T10:00:00Z",
    endedAt: "2026-09-30T10:00:20Z",
    callerFrames: 32,
    agentFrames: 60,
    turns: [
      turn({ index: 0, agentText: "Hello, thanks for calling. How can I help you today?" }),
      turn({ index: 1, agentText: "I can help with that. Could you tell me a little more?" }),
    ],
    events: [
      { at: "2026-09-30T10:00:00Z", direction: "in", type: "conversation_initiation_client_data" },
      { at: "2026-09-30T10:00:00Z", direction: "out", type: "conversation_initiation_metadata" },
    ],
    droppedEvents: 0,
  },
];

const status = {
  stack: "feat-x",
  calls: 2,
  elevenLabsBaseUrl: "http://127.0.0.1:5591",
  openaiBaseUrl: "http://127.0.0.1:5591/v1",
};

const json = ({ body, status: code = 200 }: { body: unknown; status?: number }) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { "Content-Type": "application/json" },
  });

/** voicesim's console API as the page calls it. */
const fakeSim = () => {
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input, "http://voice.test");
    if (url.pathname === "/_sim/api/status") return json({ body: status });
    if (url.pathname === "/_sim/api/calls") return json({ body: { calls } });
    return json({ body: { error: "not_found" }, status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("the voicesim console", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists recent calls and opens a call's turn timeline", async () => {
    fakeSim();
    render(<CallsConsole />);

    await waitFor(() => expect(screen.getAllByTestId("call-row")).toHaveLength(2));
    expect(screen.getByTestId("call-timeline").textContent).toContain("conv_voicesim_0002");

    fireEvent.click(screen.getByText("agent_done"));

    await waitFor(() => expect(screen.getAllByTestId("call-turn")).toHaveLength(2));
    const timeline = screen.getByTestId("call-timeline");
    expect(within(timeline).getAllByTestId("call-turn")[0]?.textContent).toContain(
      "How can I help you today?",
    );
    expect(timeline.textContent).toContain("32 caller · 60 agent");
    expect(timeline.textContent).toContain("conversation_initiation_metadata");
  });

  it("shows the sim's refusal when the calls cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ body: { error: "voicesim is down" }, status: 500 })),
    );
    render(<CallsConsole />);

    await waitFor(() => expect(screen.getAllByText(/voicesim is down/u).length).toBeGreaterThan(0));
  });
});
