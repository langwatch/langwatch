/** @see specs/prompts/prompt-studio-page.feature */
import { UiRoute } from "@langwatch/browser-host/capabilities";
import { describe, expect, it } from "vitest";

import { openDrawerAddress } from "../open-drawer-address.ts";

class RecordingRoute extends UiRoute {
  readonly writes: Readonly<Record<string, string | undefined>>[] = [];

  constructor(private readonly query: Readonly<Record<string, string | undefined>>) {
    super();
  }

  reading() {
    return { params: {}, query: this.query };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.writes.push(next);
  }
}

describe("openDrawerAddress", () => {
  /** @scenario "Opening a trace from a playground turn addresses the trace drawer" */
  it("names the trace drawer, carries the trace and drops a previous drawer's parameters", () => {
    const route = new RecordingRoute({
      "drawer.open": "promptEditor",
      "drawer.promptId": "prompt-1",
      tab: "playground",
    });

    openDrawerAddress({ drawer: "traceV2Details", params: { traceId: "trace-1" }, route });

    expect(route.writes).toEqual([
      {
        "drawer.open": "traceV2Details",
        "drawer.promptId": undefined,
        "drawer.traceId": "trace-1",
        tab: "playground",
      },
    ]);
  });
});
