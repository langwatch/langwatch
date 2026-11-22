/** The process records main's event-loop-lag histogram once metrics activate. */
import { afterEach, describe, expect, it } from "vitest";

import { createRecordingMeterProvider } from "../testing.ts";

describe("event loop lag sampler", () => {
  const provider = createRecordingMeterProvider();
  afterEach(() => provider.uninstall());

  it("records event_loop_lag_milliseconds every 500 ms after activation", async () => {
    provider.install();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const lags = provider.valuesOf("event_loop_lag_milliseconds");
    expect(lags.length).toBeGreaterThan(0);
    expect(lags.every((lag) => lag >= 0)).toBe(true);
  });
});
