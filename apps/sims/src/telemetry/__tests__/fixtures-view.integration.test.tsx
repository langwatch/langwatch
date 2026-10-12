// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FixturesView } from "../fixtures-view.tsx";
import { fakeSim, json } from "./fake-sim.ts";

const fixtures = [
  { name: "llm-trace", kind: "preset", signal: "traces", service: "telemetrysim-agent" },
  {
    name: "claude-code/session",
    kind: "recorded",
    signal: "traces",
    family: "claude-code",
    bytes: 20,
  },
];

describe("FixturesView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario The fixtures browser lists presets and recordings and shows each body */
  it("lists presets and recordings, shows a body and sends it to the door", async () => {
    const calls = fakeSim({
      routes: {
        "GET /_sim/api/fixtures": () => json({ body: { fixtures } }),
        "GET /_sim/api/fixtures/llm-trace": () =>
          json({
            body: { ...fixtures[0], bytes: 900, body: { resourceSpans: [{ marker: "seeded" }] } },
          }),
        "POST /_sim/api/send-one": () =>
          json({
            body: {
              url: "http://door/v1/traces",
              signal: "traces",
              encoding: "protobuf",
              gzip: true,
              bytes: 400,
              status: 200,
              latencyMs: 3,
            },
          }),
      },
    });
    render(<FixturesView />);

    await waitFor(() => expect(screen.getAllByTestId("fixture-row")).toHaveLength(2));
    await waitFor(() => expect(screen.getByText(/seeded/u)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Send to the door" }));

    await waitFor(() => expect(screen.getByText("200 accepted")).toBeTruthy());
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      preset: "llm-trace",
      seed: 1,
      encoding: "protobuf",
    });
  });
});
