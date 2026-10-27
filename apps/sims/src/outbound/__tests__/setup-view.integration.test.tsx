// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SetupView } from "../setup-view.tsx";
import { fakeSim, json } from "./fake-sim.ts";

const urls = [
  {
    label: "Sign-up announcements",
    channel: "slack-webhook",
    url: "http://outbound.test/services/T0SIM/B0SIGNUPS/x",
    setting: "SLACK_CHANNEL_SIGNUPS",
  },
  { label: "Receiver ok", channel: "webhook", url: "http://outbound.test/hooks/ok" },
];

describe("SetupView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario The console shows records, deliveries, faults and setup */
  it("shows every URL to paste with the setting that takes it", async () => {
    fakeSim({ routes: { "GET /_sim/api/setup": () => json({ body: { urls } }) } });
    render(<SetupView />);

    await waitFor(() => expect(screen.getByText("http://outbound.test/hooks/ok")).toBeTruthy());
    expect(screen.getByText("SLACK_CHANNEL_SIGNUPS")).toBeTruthy();
    expect(screen.getByText("Sign-up announcements")).toBeTruthy();
  });
});
