// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SendOneView } from "../send-one-view.tsx";
import { statusSchema } from "../telemetry-api.ts";
import { fakeSim, json, wireStatus } from "./fake-sim.ts";

const status = statusSchema.parse(wireStatus);
const refresh = async () => undefined;

const answer = {
  url: "https://app.feat-x.langwatch.localhost/api/otel/v1/traces",
  signal: "traces",
  encoding: "protobuf",
  gzip: true,
  bytes: 812,
  status: 429,
  retryAfter: "2",
  contentType: "application/json",
  body: '{"error":"slow down"}',
  latencyMs: 4.2,
};

describe("SendOneView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario Send one posts a single OTLP request and shows the door's answer */
  it("sends one preset batch and shows the door's status, Retry-After and body", async () => {
    const calls = fakeSim({ routes: { "POST /_sim/api/send-one": () => json({ body: answer }) } });
    render(<SendOneView status={status} refresh={refresh} />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByTestId("send-one-answer")).toBeTruthy());
    expect(screen.getByText("429 rate limited")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText(/slow down/u)).toBeTruthy();
    expect(calls[0]?.body).toEqual({
      preset: "llm-trace",
      seed: 1,
      encoding: "protobuf",
      noGzip: false,
    });
  });

  /** @scenario Send one converts a pasted OTLP JSON body and refuses one it cannot read */
  it("posts a pasted body and shows the sim's refusal", async () => {
    const calls = fakeSim({
      routes: {
        "POST /_sim/api/send-one": () =>
          json({
            body: { error: "an OTLP body needs resourceSpans, resourceLogs or resourceMetrics" },
            status: 400,
          }),
      },
    });
    render(<SendOneView status={status} refresh={refresh} />);

    fireEvent.click(screen.getByLabelText("Pasted OTLP JSON"));
    fireEvent.change(screen.getByLabelText("OTLP JSON export request"), {
      target: { value: '{"spans":[]}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText(/needs resourceSpans/u)).toBeTruthy());
    expect(calls[0]?.body).toEqual({ body: '{"spans":[]}', encoding: "protobuf", noGzip: false });
  });
});
