/**
 * A widget run carries the reader's zone, read from the browser, and UTC when the browser names
 * none the server would accept.
 * @see modules/analytics/specs/dashboard-widget-time-zone.feature
 */
import type { LangWatchQLQueryResult } from "@langwatch/analytics-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { browserTimeZone } from "../browser-time-zone.ts";
import { createLangWatchQLExecute } from "../lwql-execute.ts";

async function sentTimeZone(request: { timeZone?: string } = {}): Promise<unknown> {
  const sent: Record<string, unknown>[] = [];
  const execute = createLangWatchQLExecute({
    transport: {
      mutate: async (input) => {
        sent.push({ ...input });
        return {} as LangWatchQLQueryResult;
      },
    },
    projectId: "board",
  });
  await execute({ sql: "SELECT 1", ...request }, { signal: new AbortController().signal });

  return sent[0]?.timeZone;
}

function browserReports(zone: string | undefined) {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: zone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given a reader whose browser reports America/Los_Angeles", () => {
  /** @scenario "TZ01 A widget run carries the browser's time zone" */
  it("sends that zone on the run", async () => {
    browserReports("America/Los_Angeles");

    expect(await sentTimeZone()).toBe("America/Los_Angeles");
  });

  /** @scenario "TZ01 A widget run carries the browser's time zone" */
  it("keeps a zone the request names itself", async () => {
    browserReports("America/Los_Angeles");

    expect(await sentTimeZone({ timeZone: "Asia/Kolkata" })).toBe("Asia/Kolkata");
  });
});

describe("given a browser that names no usable zone", () => {
  /** @scenario "TZ03 A browser that names no usable time zone falls back to UTC" */
  it.each([undefined, "", "Not/AZone", "+05:00"])(
    "reads %j as UTC, and sends UTC",
    async (zone) => {
      browserReports(zone);

      expect(browserTimeZone()).toBe("UTC");
      expect(await sentTimeZone()).toBe("UTC");
    },
  );
});
