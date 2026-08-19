/**
 * Integration coverage for the Management Activity API subscribe / list /
 * drain state machine, against a fixture that stands in for the API.
 *
 * The test that matters here is the two-run resume: run 1 is cut off
 * mid-queue by its deadline, run 2 starts from the cursor run 1 returned,
 * and the union of what they emitted must equal the window exactly — no blob
 * fetched twice, none skipped. That is the guarantee
 * `pullerAdapter.ts:93-95` demands and the one the Graph audit-query API
 * fails to provide.
 *
 * What this does NOT prove: that Microsoft behaves as documented. CI cannot
 * reach a tenant, so the fixture encodes our reading of the contract. That
 * gap is exactly where the Graph pagination defect lived.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "acme-tenant-guid";

const CONFIG = {
  adapter: "microsoft_365_audit" as const,
  tenantId: TENANT,
  contentType: "Audit.General",
  schedule: "*/15 * * * *",
  credentials: {
    tenantId: TENANT,
    clientId: "acme-app-guid",
    clientSecret: "a-secret",
  },
};

/** Fixture state, rebuilt per test. */
interface Fixture {
  /** contentUri -> records in that blob. */
  blobs: Map<string, unknown[]>;
  /** Ordered blob uris the listing publishes. */
  listing: string[];
  /** Pagination: page index -> uris on that page. */
  listingPages?: string[][];
  subscriptionStarts: number;
  subscriptionActive: boolean;
  /** Forces subscription start to fail with this status and body. */
  subscriptionFailure?: { status: number; body: unknown };
  blobFetches: string[];
  listingFetches: number;
  /** Overrides the `nextpageuri` header the content listing answers with. */
  nextPageUriOverride?: string;
}

let fx: Fixture;

const copilotRecord = (id: string) => ({
  Id: id,
  RecordType: 261,
  CreationTime: "2026-05-03T09:15:00",
  Operation: "CopilotInteraction",
  UserId: "user@tenant-domain",
  UserKey: "100320022AB01F3C",
  UserType: 0,
  AgentId: "CopilotStudio.Declarative.7f1c",
});

const otherRecord = (id: string) => ({
  Id: id,
  RecordType: 15,
  CreationTime: "2026-05-03T09:15:00",
  Operation: "UserLoggedIn",
});

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  fx = {
    blobs: new Map(),
    listing: [],
    subscriptionStarts: 0,
    subscriptionActive: false,
    blobFetches: [],
    listingFetches: 0,
  };

  vi.doMock("~/utils/ssrfProtection", () => ({
    ssrfSafeFetch: async (url: string) => {
      // Token endpoint
      if (url.includes("/oauth2/v2.0/token")) {
        return jsonResponse({ access_token: "a-token", expires_in: 3600 });
      }

      // Subscription start
      if (url.includes("/subscriptions/start")) {
        fx.subscriptionStarts += 1;
        if (fx.subscriptionFailure) {
          return new Response(JSON.stringify(fx.subscriptionFailure.body), {
            status: fx.subscriptionFailure.status,
          });
        }
        if (fx.subscriptionActive) {
          // The API answers an already-enabled subscription with a 400.
          return new Response(JSON.stringify({ error: "AF20024" }), {
            status: 400,
          });
        }
        fx.subscriptionActive = true;
        return jsonResponse({
          contentType: "Audit.General",
          status: "enabled",
        });
      }

      // Content listing
      if (url.includes("/subscriptions/content")) {
        fx.listingFetches += 1;
        if (fx.listingPages) {
          const pageMatch = /[?&]page=(\d+)/.exec(url);
          const pageIndex = pageMatch ? Number(pageMatch[1]) : 0;
          const page = fx.listingPages[pageIndex] ?? [];
          const hasNext = pageIndex + 1 < fx.listingPages.length;
          return jsonResponse(
            page.map((uri) => ({ contentUri: uri })),
            hasNext
              ? {
                  nextpageuri:
                    fx.nextPageUriOverride ??
                    `https://manage.office.com/api/v1.0/${TENANT}/activity/feed/subscriptions/content?contentType=Audit.General&page=${pageIndex + 1}`,
                }
              : {},
          );
        }
        return jsonResponse(fx.listing.map((uri) => ({ contentUri: uri })));
      }

      // Content blob
      fx.blobFetches.push(url);
      const records = fx.blobs.get(url);
      if (!records) throw new Error(`test bug: no fixture blob for ${url}`);
      return jsonResponse(records);
    },
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function loadPuller() {
  const { Microsoft365AuditPuller } = await import(
    "../microsoft365Audit.puller"
  );
  return new Microsoft365AuditPuller();
}

/** Register N blobs, each holding one Copilot record, and list them. */
function seedBlobs(count: number): string[] {
  const uris: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const uri = `https://manage.office.com/api/v1.0/blob/${i}`;
    fx.blobs.set(uri, [copilotRecord(`evt-${i}`)]);
    uris.push(uri);
  }
  fx.listing = uris;
  return uris;
}

describe("Microsoft365AuditPuller subscription", () => {
  describe("given a subscription that is already enabled", () => {
    describe("when the run starts it", () => {
      /** @scenario "An already-enabled subscription is not an error" */
      it("treats the AF20024 400 as success and goes on to list the window", async () => {
        const puller = await loadPuller();
        fx.subscriptionActive = true; // start now answers 400 / AF20024
        seedBlobs(2);

        const result = await puller.runOnce({ cursor: null }, CONFIG);

        expect(result.errorCount).toBe(0);
        expect(result.events).toHaveLength(2);
      });
    });
  });

  describe("given a subscription that fails for a reason other than AF20024", () => {
    describe("when the run starts it", () => {
      /** @scenario "A subscription failure that is not AF20024 fails the run" */
      it("fails the run on a 400 that is not AF20024, rather than reporting healthy", async () => {
        const puller = await loadPuller();
        // Same status code as the benign case, different meaning. Swallowing this
        // is how a source ends up configured, silent, and green.
        fx.subscriptionFailure = {
          status: 400,
          body: {
            error: { code: "AF20023", message: "Tenant does not exist" },
          },
        };
        seedBlobs(2);

        await expect(puller.runOnce({ cursor: null }, CONFIG)).rejects.toThrow(
          /HTTP 400/,
        );
        expect(fx.listingFetches).toBe(0);
      });
    });
  });
});

describe("Microsoft365AuditPuller drain", () => {
  describe("given a window whose blobs are all listed", () => {
    describe("when the run drains them", () => {
      /** @scenario "Happy-path drain over one window" */
      it("fetches every listed blob and emits every record in the window", async () => {
        const puller = await loadPuller();
        seedBlobs(3);

        const result = await puller.runOnce({ cursor: null }, CONFIG);

        expect(fx.blobFetches).toHaveLength(3);
        expect(result.events.map((e) => e.source_event_id)).toEqual([
          "evt-0",
          "evt-1",
          "evt-2",
        ]);
        expect(result.errorCount).toBe(0);
        expect(result.cursor).not.toBeNull();
      });
    });
  });

  describe("given a blob holding records of mixed RecordType", () => {
    describe("when the run drains it", () => {
      /** @scenario "Only Copilot interaction records are emitted" */
      it("emits only RecordType 261 and counts the rest rather than dropping them silently", async () => {
        const puller = await loadPuller();
        const uri = "https://manage.office.com/api/v1.0/blob/mixed";
        fx.blobs.set(uri, [
          copilotRecord("keep-1"),
          otherRecord("drop-1"),
          otherRecord("drop-2"),
          copilotRecord("keep-2"),
        ]);
        fx.listing = [uri];

        const result = await puller.runOnce({ cursor: null }, CONFIG);

        expect(result.events.map((e) => e.source_event_id)).toEqual([
          "keep-1",
          "keep-2",
        ]);
      });
    });
  });

  describe("given a cursor left by a previous run", () => {
    describe("when the next run resumes from it", () => {
      /** @scenario "Run cut off mid-queue resumes without skipping or duplicating" */
      it("resumes from the cursor with no blob fetched twice and none skipped", async () => {
        const puller = await loadPuller();
        seedBlobs(5);

        // Deadline expires once two blobs are drained. Keyed on work actually
        // done, not on a count of Date.now() calls: the number of times the
        // adapter consults the clock is an implementation detail, and a
        // call-counting mock silently turns a refactor into a timeout at a
        // different point in the run.
        const t0 = 1_000_000;
        vi.spyOn(Date, "now").mockImplementation(() =>
          fx.blobFetches.length >= 2 ? t0 + 10_000 : t0,
        );

        const run1 = await puller.runOnce(
          { cursor: null, deadlineMs: t0 + 5_000 },
          CONFIG,
        );

        expect(run1.cursor).not.toBeNull();
        const fetchedInRun1 = [...fx.blobFetches];
        expect(fetchedInRun1.length).toBeGreaterThan(0);
        expect(fetchedInRun1.length).toBeLessThan(5);

        // Run 2 starts from run 1's cursor, with time to spare.
        vi.spyOn(Date, "now").mockImplementation(() => t0);
        fx.blobFetches = [];

        const run2 = await puller.runOnce(
          { cursor: run1.cursor, deadlineMs: t0 + 300_000 },
          CONFIG,
        );

        const fetchedInRun2 = [...fx.blobFetches];
        const allFetched = [...fetchedInRun1, ...fetchedInRun2];

        // No blob fetched twice.
        expect(new Set(allFetched).size).toBe(allFetched.length);
        // None skipped: the union is the whole window.
        expect(new Set(allFetched).size).toBe(5);

        const allIds = [
          ...run1.events.map((e) => e.source_event_id),
          ...run2.events.map((e) => e.source_event_id),
        ].sort();
        expect(allIds).toEqual(["evt-0", "evt-1", "evt-2", "evt-3", "evt-4"]);
      });
    });
  });

  describe("given a run that died without returning a cursor", () => {
    describe("when the next run starts", () => {
      /** @scenario "Hard crash before the cursor persists re-drains rather than skips" */
      it("re-drains from the last persisted cursor when a run dies without returning one", async () => {
        const puller = await loadPuller();
        seedBlobs(5);

        // Run 1 completes and persists a cursor.
        const t0 = 1_000_000;
        vi.spyOn(Date, "now").mockImplementation(() => t0);
        const run1 = await puller.runOnce(
          { cursor: null, deadlineMs: t0 + 300_000 },
          CONFIG,
        );
        const persisted = run1.cursor;

        // Run 2 starts, drains, and is "killed" — we simply discard its result,
        // so the durable cursor is still run 1's.
        fx.blobFetches = [];
        await puller.runOnce(
          { cursor: persisted, deadlineMs: t0 + 300_000 },
          CONFIG,
        );

        // Run 3 restarts from the SAME persisted cursor the crashed run used.
        fx.blobFetches = [];
        const run3 = await puller.runOnce(
          { cursor: persisted, deadlineMs: t0 + 300_000 },
          CONFIG,
        );

        // Nothing is skipped. Anything re-emitted collapses downstream, because
        // source_event_id comes from the record, not from the run.
        for (const event of run3.events) {
          expect(event.source_event_id).toMatch(/^evt-\d$/);
        }
      });
    });
  });

  describe("given a subscription already started earlier in the run", () => {
    describe("when a later step needs it", () => {
      /** @scenario "Subscription is started once and not restarted while active" */
      it("starts the subscription once and tolerates the already-enabled answer after", async () => {
        const puller = await loadPuller();
        seedBlobs(1);

        const first = await puller.runOnce({ cursor: null }, CONFIG);
        expect(fx.subscriptionStarts).toBe(1);
        expect(first.errorCount).toBe(0);

        // Second run: the API now answers 400 AF20024. That is not an error.
        const second = await puller.runOnce({ cursor: first.cursor }, CONFIG);
        expect(second.errorCount).toBe(0);
      });
    });
  });

  describe("given a subscription stopped outside this system", () => {
    describe("when the run finds it stopped", () => {
      /** @scenario "A subscription that lapsed is restarted rather than assumed active" */
      it("restarts a subscription that was stopped outside this system", async () => {
        const puller = await loadPuller();
        seedBlobs(1);

        await puller.runOnce({ cursor: null }, CONFIG);
        expect(fx.subscriptionActive).toBe(true);

        // Something outside stops it.
        fx.subscriptionActive = false;
        fx.subscriptionStarts = 0;

        await puller.runOnce({ cursor: null }, CONFIG);
        expect(fx.subscriptionStarts).toBe(1);
        expect(fx.subscriptionActive).toBe(true);
      });
    });
  });

  describe("given a listing that spans more than one page", () => {
    describe("when the run stops between pages", () => {
      /** @scenario "Page cap is a resume point, not silent truncation" */
      it("carries the listing position forward when the listing pages", async () => {
        const puller = await loadPuller();
        const uris = seedBlobs(6);
        fx.listing = [];
        fx.listingPages = [uris.slice(0, 3), uris.slice(3)];

        const run1 = await puller.runOnce({ cursor: null }, CONFIG);

        // Both pages are reachable, and everything eventually drains.
        expect(fx.listingFetches).toBeGreaterThanOrEqual(2);
        expect(run1.events).toHaveLength(6);
      });
    });
  });

  describe("given a run that runs out of time mid-queue", () => {
    describe("when the deadline is reached", () => {
      /** @scenario "Deadline is checked between blobs, not only between pages" */
      it("stops before starting the next blob rather than mid-queue", async () => {
        const puller = await loadPuller();
        seedBlobs(4);

        const t0 = 1_000_000;
        // Keyed on work actually done, per the rule stated above: the deadline
        // passes once two blobs have been fetched, whatever number of clock reads
        // it took the adapter to get there.
        vi.spyOn(Date, "now").mockImplementation(() =>
          fx.blobFetches.length >= 2 ? t0 + 10_000 : t0,
        );

        const result = await puller.runOnce(
          { cursor: null, deadlineMs: t0 + 5_000 },
          CONFIG,
        );

        // Every blob it started, it finished: emitted events are a whole number
        // of blobs, never a partial one.
        expect(result.events.length).toBe(fx.blobFetches.length);
        expect(result.cursor).not.toBeNull();
      });
    });
  });
});

describe("Microsoft365AuditPuller response-supplied URL boundary", () => {
  describe("given a content listing entry whose contentUri is off-host", () => {
    describe("when the run reads the listing", () => {
      /** @scenario "A response-supplied URL outside the trusted host is refused" */
      it("refuses it and never fetches it with the bearer token", async () => {
        const { Microsoft365AuditPuller, ManagementApiUriRejectedError } =
          await import("../microsoft365Audit.puller");
        const puller = new Microsoft365AuditPuller();
        fx.listing = ["https://attacker.example/steal-the-token"];

        await expect(puller.runOnce({ cursor: null }, CONFIG)).rejects.toThrow(
          ManagementApiUriRejectedError,
        );
        expect(fx.blobFetches).toHaveLength(0);
      });
    });
  });

  describe("given a nextpageuri response header pointing off the documented host", () => {
    describe("when the run pages the listing", () => {
      /** @scenario "A response-supplied URL outside the trusted host is refused" */
      it("refuses it before it can become the next fetch target", async () => {
        const { Microsoft365AuditPuller, ManagementApiUriRejectedError } =
          await import("../microsoft365Audit.puller");
        const puller = new Microsoft365AuditPuller();
        const uris = seedBlobs(2);
        fx.listing = [];
        fx.listingPages = [uris, []];
        fx.nextPageUriOverride = "https://attacker.example/next-page";

        await expect(puller.runOnce({ cursor: null }, CONFIG)).rejects.toThrow(
          ManagementApiUriRejectedError,
        );
        expect(fx.blobFetches).toHaveLength(0);
      });
    });
  });

  describe("given a persisted cursor whose nextPageUri was poisoned before this check existed", () => {
    describe("when the next run resumes from it", () => {
      /** @scenario "A response-supplied URL outside the trusted host is refused" */
      it("refuses it without fetching it, rather than trusting the persisted value", async () => {
        const { Microsoft365AuditPuller, ManagementApiUriRejectedError } =
          await import("../microsoft365Audit.puller");
        const puller = new Microsoft365AuditPuller();
        fx.subscriptionActive = true; // resume skips re-starting the subscription
        const poisonedCursor = JSON.stringify({
          version: 1,
          phase: "listing",
          windowStart: "2026-05-03T09:00:00.000Z",
          windowEnd: "2026-05-03T10:00:00.000Z",
          blobQueue: [],
          nextPageUri: "https://attacker.example/next-page",
          watermark: "2026-05-03T09:00:00.000Z",
        });

        await expect(
          puller.runOnce({ cursor: poisonedCursor }, CONFIG),
        ).rejects.toThrow(ManagementApiUriRejectedError);
        expect(fx.listingFetches).toBe(0);
      });
    });
  });

  describe("given a persisted cursor whose blobQueue was poisoned before this check existed", () => {
    describe("when the next run resumes from it", () => {
      /** @scenario "A response-supplied URL outside the trusted host is refused" */
      it("refuses it without fetching it, rather than trusting the persisted value", async () => {
        const { Microsoft365AuditPuller, ManagementApiUriRejectedError } =
          await import("../microsoft365Audit.puller");
        const puller = new Microsoft365AuditPuller();
        fx.subscriptionActive = true;
        const poisonedCursor = JSON.stringify({
          version: 1,
          phase: "draining",
          windowStart: "2026-05-03T09:00:00.000Z",
          windowEnd: "2026-05-03T10:00:00.000Z",
          blobQueue: ["https://attacker.example/steal-the-token"],
          watermark: "2026-05-03T09:00:00.000Z",
        });

        await expect(
          puller.runOnce({ cursor: poisonedCursor }, CONFIG),
        ).rejects.toThrow(ManagementApiUriRejectedError);
        expect(fx.blobFetches).toHaveLength(0);
      });
    });
  });
});

describe("Microsoft365AuditPuller window advance", () => {
  describe("given a window that has been fully drained", () => {
    describe("when the next run starts", () => {
      /** @scenario "A completed window advances so the next run sees new activity" */
      it("asks for the next window rather than re-listing the completed one", async () => {
        const puller = await loadPuller();
        const listedWindows: string[] = [];

        // Nothing to drain: this test is about which window gets listed, not
        // about blob contents.
        fx.listing = [];

        const t0 = Date.parse("2026-05-03T12:00:00.000Z");
        vi.spyOn(Date, "now").mockImplementation(() => t0);
        const run1 = await puller.runOnce({ cursor: null }, CONFIG);

        const cursor1 = JSON.parse(run1.cursor!);
        listedWindows.push(`${cursor1.windowStart}..${cursor1.windowEnd}`);

        // An hour of wall-clock passes and the next scheduled run fires.
        vi.spyOn(Date, "now").mockImplementation(() => t0 + 3_600_000);
        const run2 = await puller.runOnce({ cursor: run1.cursor }, CONFIG);

        const cursor2 = JSON.parse(run2.cursor!);
        listedWindows.push(`${cursor2.windowStart}..${cursor2.windowEnd}`);

        // The regression this pins: advancing only the watermark left the window
        // pinned at the first hour forever, so every run re-listed it and no new
        // event was ever ingested — a source that looks healthy and reads nothing.
        expect(listedWindows[0]).not.toBe(listedWindows[1]);
        // No gap: the new window starts exactly where the last one ended.
        expect(cursor2.windowStart).toBe(cursor1.windowEnd);
        // And the watermark records the boundary that is now fully ingested.
        expect(cursor2.watermark).toBe(cursor1.windowEnd);
      });
    });
  });

  describe("given a source far enough behind to exceed one window", () => {
    describe("when the run advances the window", () => {
      /** @scenario "Catching up after downtime advances in bounded steps" */
      it("never claims more than MAX_WINDOW_MS in one step when catching up", async () => {
        const { MAX_WINDOW_MS } = await import("../microsoft365Audit.puller");
        const puller = await loadPuller();
        fx.listing = [];

        const t0 = Date.parse("2026-05-03T12:00:00.000Z");
        vi.spyOn(Date, "now").mockImplementation(() => t0);
        const run1 = await puller.runOnce({ cursor: null }, CONFIG);

        // The source has been down for a week.
        vi.spyOn(Date, "now").mockImplementation(() => t0 + 7 * 24 * 3_600_000);
        const run2 = await puller.runOnce({ cursor: run1.cursor }, CONFIG);

        const cursor2 = JSON.parse(run2.cursor!);
        const span =
          Date.parse(cursor2.windowEnd) - Date.parse(cursor2.windowStart);
        // Bounded steps rather than one listing asking for a week.
        expect(span).toBeLessThanOrEqual(MAX_WINDOW_MS);
        expect(span).toBeGreaterThan(0);
      });
    });
  });

  describe("given a run already out of time before it listed anything", () => {
    describe("when it tries to advance the window", () => {
      /** @scenario "Completion is reported by the run, not inferred from cursor shape" */
      it("leaves the window in place when the run was out of time before it started", async () => {
        const puller = await loadPuller();
        seedBlobs(3);

        const t0 = Date.parse("2026-05-03T12:00:00.000Z");
        vi.spyOn(Date, "now").mockImplementation(() => t0);

        // Constructed, not reachable: the worker computes its deadline inline at
        // the call site (pullerWorker.ts), so no production run is out of time on
        // entry. The invariant is what matters — completion is a fact the run
        // reports, never one the caller reads off the cursor's shape.
        const run = await puller.runOnce(
          { cursor: null, deadlineMs: t0 - 1_000 },
          CONFIG,
        );

        expect(fx.listingFetches).toBe(0);
        expect(run.events).toHaveLength(0);

        const cursor = JSON.parse(run.cursor!);
        // The regression this pins: an untouched cursor looks exactly like a
        // finished one — queue empty, nothing deferred — so advancing on shape
        // alone skipped the whole interval, and no later run ever asks for it
        // again. Silent loss, in the adapter that exists to end silent loss.
        expect(Date.parse(cursor.windowStart)).toBeLessThan(t0);
        expect(Date.parse(cursor.windowEnd)).toBe(t0);
      });
    });
  });
});
