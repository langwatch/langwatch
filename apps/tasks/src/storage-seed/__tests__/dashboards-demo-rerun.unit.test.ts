/**
 * The dashboards demo's traffic half against a stand-in stack: which doors it goes through,
 * how much history each door gets, and that a second run sends nothing the stack already holds.
 * @see specs/setup/dashboards-demo-seed.feature
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoHttp } from "../dashboards-demo-http.ts";
import { DASHBOARDS_DEMO_PROJECTS } from "../dashboards-demo-ids.ts";
import { type DashboardsDemoRun, sendDashboardsDemoTraffic } from "../seed-dashboards-demo.ts";
import { DemoStack } from "./dashboards-demo-stack.fixture.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A Thursday afternoon, so the days before it hold working days and a weekend. */
const NOW = Date.UTC(2026, 9, 8, 15);
const ENDPOINT = "http://localhost:6560";
const MIRROR = { projectId: "langy-mirror-project", apiKey: "sk-lw-langy-mirror" };
const KEY_OF = Object.fromEntries(DASHBOARDS_DEMO_PROJECTS.map(({ id, apiKey }) => [id, apiKey]));
const PROJECT_KEYS = { ...KEY_OF, [MIRROR.projectId]: MIRROR.apiKey };
const [CARE, PLATFORM, ENGINEERING, DAY_ZERO] = DASHBOARDS_DEMO_PROJECTS.map(
  ({ apiKey }) => apiKey,
);
/** The doors that add to a trace the project already holds. */
const TRACE_FOLLOWERS = ["/api/collector", "/api/track_event"];
const WRITE_DOORS = [
  "/api/otel/v1/traces",
  "/api/collector",
  "/api/track_event",
  "/api/scenario-events",
  "/api/evaluations/batch/log_results",
  "/api/prompts",
  "/api/otel/v1/logs",
  "/api/internal/gateway/spend-commands",
  "/api/gateway/v1/virtual-keys",
];

/** A first run sends a month of traffic, so the suites that read one share it. */
const RUN_TIMEOUT_MS = 120_000;

let stack: DemoStack;

/** Points the seed's HTTP at whichever stack the suite is on. */
function stubFetch(): void {
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    stack.fetch(input, init),
  );
}

function sendTo(next: DemoStack): void {
  stack = next;
  stubFetch();
}

function runAt({ now = NOW, days = 60 }: { now?: number; days?: number } = {}): DashboardsDemoRun {
  return {
    prisma: stack.prisma(),
    endpoint: ENDPOINT,
    signal: new AbortController().signal,
    days,
    scale: 0.3,
    now,
    todayStart: Math.floor(now / DAY_MS) * DAY_MS,
    gatewaySecret: "gateway-secret",
  };
}

const send = (run: DashboardsDemoRun = runAt()) =>
  sendDashboardsDemoTraffic({ run, langyMirror: MIRROR });

const pathsOf = (apiKey: string) =>
  new Set(stack.requests.filter((request) => request.apiKey === apiKey).map(({ path }) => path));

const oldest = (times: Iterable<number>) => (NOW - Math.min(...times)) / DAY_MS;

beforeEach(stubFetch);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("given a stack that holds nothing of the demo", () => {
  describe("when the seed sends 60 days of traffic", () => {
    beforeAll(async () => {
      sendTo(new DemoStack(PROJECT_KEYS));
      await send();
    }, RUN_TIMEOUT_MS);

    /** @scenario "Traffic goes through the stack's own doors with each project's key" */
    it("sends every kind of traffic through its own door, with the project's key", () => {
      const doors = new Set(stack.writes().map(({ path }) => path));
      const held = stack.holdings(CARE ?? "");

      expect([...doors].filter((path) => WRITE_DOORS.includes(path)).toSorted()).toEqual(
        WRITE_DOORS.toSorted(),
      );
      expect([...doors].some((path) => path.startsWith("/api/annotations/trace/"))).toBe(true);
      expect([...doors].some((path) => path.startsWith("/api/prompts/"))).toBe(true);
      expect(pathsOf(ENGINEERING ?? "")).toContain("/api/otel/v1/logs");
      expect(pathsOf(ENGINEERING ?? "")).toContain("/api/otel/v1/traces");
      expect(held.virtualKeys.map(({ name }) => name).toSorted()).toEqual([
        "delivery-caller",
        "help-center-answerer",
        "shop-assistant",
      ]);
      expect(new Set([...held.settledSpend.values()].map((spend) => spend.virtualKeyId))).toEqual(
        new Set(held.virtualKeys.map(({ id }) => id)),
      );
      expect(held.traces.size).toBeGreaterThan(100);
    });

    /** @scenario "Three projects run named agents, and one project is empty" */
    it("sends the day-zero project nothing at all", () => {
      expect(pathsOf(DAY_ZERO ?? "")).toEqual(new Set());
    });

    /** @scenario "Each door gets as much history as the stack keeps for it" */
    it("sends traces for the last 30 days, and gateway spend for all 60", () => {
      const care = stack.holdings(CARE ?? "");
      const traceAge = oldest([...care.traces.values()].map((trace) => trace.startedAt));
      const spendAge = oldest([...care.settledSpend.values()].map((spend) => spend.occurredAt));

      expect(traceAge).toBeGreaterThan(29);
      expect(traceAge).toBeLessThanOrEqual(30);
      expect(spendAge).toBeGreaterThan(58);
      expect(oldest(stack.datedRows.promptVersions.values())).toBeGreaterThan(58);
    });

    /** @scenario "Each door gets as much history as the stack keeps for it" */
    it("sends evaluations and thumbs only for the traces it sent", () => {
      const sent = stack.holdings(CARE ?? "").traces;
      const named = stack.requests
        .filter(({ apiKey, path }) => apiKey === CARE && TRACE_FOLLOWERS.includes(path))
        .map(({ body }) => (body as { trace_id: string }).trace_id);

      expect(named.length).toBeGreaterThan(100);
      expect(named.filter((traceId) => !sent.has(traceId))).toEqual([]);
    });

    /** @scenario "Each door gets as much history as the stack keeps for it" */
    it("sends the mirror project Langy turns for the last 30 days only", () => {
      const turnAge = oldest(
        [...stack.holdings(MIRROR.apiKey).traces.values()].map((trace) => trace.startedAt),
      );

      expect(turnAge).toBeGreaterThan(29);
      expect(turnAge).toBeLessThanOrEqual(30);
    });

    /** @scenario "History older than the stack's data retention is not sent" */
    it("sends scenario runs and coding sessions for the last 48 days only", () => {
      const runAge = oldest(stack.holdings(CARE ?? "").finishedScenarioRuns.values());
      const sessionAge = oldest(stack.holdings(ENGINEERING ?? "").sessions.values());

      expect(runAge).toBeGreaterThan(40);
      expect(runAge).toBeLessThanOrEqual(48);
      expect(sessionAge).toBeGreaterThan(40);
      expect(sessionAge).toBeLessThanOrEqual(48);
    });

    /** @scenario "Langy's own turns sit beside a normal project's traces" */
    it("makes about 5% of Customer care's traces Langy turns, and none anywhere else", () => {
      const traces = [...stack.holdings(CARE ?? "").traces.values()];
      const langy = traces.filter((trace) => trace.isLangy).length;
      const elsewhere = [PLATFORM, ENGINEERING].flatMap((key) =>
        [...stack.holdings(key ?? "").traces.values()].filter((trace) => trace.isLangy),
      );

      expect(langy / traces.length).toBeGreaterThan(0.03);
      expect(langy / traces.length).toBeLessThan(0.07);
      expect(elsewhere).toEqual([]);
    });

    /** @scenario "Langy history lands in the Langy mirror project" */
    it("sends the mirror project Langy turns only, and reviewer thumbs on some", () => {
      const mirror = stack.holdings(MIRROR.apiKey);

      expect(mirror.traces.size).toBeGreaterThan(20);
      expect([...mirror.traces.values()].every((trace) => trace.isLangy)).toBe(true);
      expect(mirror.reviewedTraces.size).toBeGreaterThan(0);
    });

    /** @scenario "The seed writes to the database only where no door exists" */
    it("dates prompt versions and reviewer thumbs, and writes the review queue, in the database", () => {
      const reviewed = [...stack.holdings(CARE ?? "").reviewedTraces].map(
        (traceId) => `${DASHBOARDS_DEMO_PROJECTS[0]?.id}:${traceId}`,
      );

      expect(stack.datedRows.promptVersions.size).toBeGreaterThan(5);
      expect(reviewed.length).toBeGreaterThan(0);
      expect(reviewed.filter((row) => !stack.datedRows.annotations.has(row))).toEqual([]);
      expect(stack.datedRows.queueItems.size).toBeGreaterThan(0);
    });

    describe("when it runs again at the same moment", () => {
      /** @scenario "Re-running the seed sends only what a project does not hold yet" */
      it("sends nothing a project already holds", { timeout: RUN_TIMEOUT_MS }, async () => {
        const before = stack.requests.length;
        const held = stack.holdings(CARE ?? "").traces.size;
        const dated = structuredClone(stack.datedRows);

        await send();

        expect(stack.writes({ since: before })).toEqual([]);
        expect(stack.repeats).toEqual([]);
        expect(stack.holdings(CARE ?? "").traces.size).toBe(held);
        expect(stack.datedRows).toEqual(dated);
      });

      /** @scenario "What a project holds is asked of the stack's own read APIs" */
      it(
        "asks the trace search and the query door what each project holds",
        { timeout: RUN_TIMEOUT_MS },
        async () => {
          const before = stack.requests.length;

          await send();

          const reads = stack.requests.slice(before).filter(({ apiKey }) => apiKey === CARE);
          const filters = reads
            .filter(({ path }) => path === "/api/traces/search")
            .map(({ body }) => (body as { filter?: string }).filter);
          const queries = reads
            .filter(({ path }) => path === "/api/v1/query")
            .map(({ body }) => (body as { sql: string }).sql);
          expect(new Set(filters)).toEqual(new Set([undefined, "origin:langy"]));
          expect(queries.some((sql) => sql.includes("FROM simulations"))).toBe(true);
          expect(queries.some((sql) => sql.includes("FROM gateway_request_spend"))).toBe(true);
          expect(queries.some((sql) => sql.includes("FROM experiment_run_results"))).toBe(true);
        },
      );
    });
  });

  describe("when the seed runs, then again an hour later and a week later", () => {
    /** @scenario "Re-running the seed sends only what a project does not hold yet" */
    it(
      "adds only the traffic that happened since, and repeats no id",
      async () => {
        sendTo(new DemoStack(PROJECT_KEYS));
        const held = () => stack.holdings(CARE ?? "").traces.size;
        await send();
        const first = held();

        await send(runAt({ now: NOW + HOUR_MS }));
        const anHourOn = held();
        await send(runAt({ now: NOW + 7 * DAY_MS }));

        expect(stack.repeats).toEqual([]);
        expect(anHourOn).toBeGreaterThan(first);
        expect(anHourOn - first).toBeLessThan(first / 20);
        expect(held()).toBeGreaterThan(anHourOn + first / 10);
      },
      RUN_TIMEOUT_MS,
    );
  });

  describe("when a project's traces cannot be listed", () => {
    beforeEach(() => sendTo(new DemoStack(PROJECT_KEYS)));

    /** @scenario "What a project holds is asked of the stack's own read APIs" */
    it("stops with the stack's answer and sends nothing blind", async () => {
      stack.answers.set("/api/traces/search", { status: 403, body: "no traces:view on this key" });

      await expect(send()).rejects.toThrow("answered 403: no traces:view on this key");
      expect(stack.writes()).toEqual([]);
    });
  });

  describe("when a trace door answers 200 but reports rejected spans", () => {
    beforeEach(() => sendTo(new DemoStack(PROJECT_KEYS)));

    /** @scenario "A door that drops data inside a 200 is a refusal" */
    it(
      "counts each such body as refused and stops once more than 25 are",
      { timeout: RUN_TIMEOUT_MS },
      async () => {
        stack.answers.set("/api/otel/v1/traces", {
          status: 200,
          body: JSON.stringify({ partialSuccess: { rejectedSpans: 3 } }),
        });

        await expect(send()).rejects.toThrow(
          /^Stopped after 26 refusals; the last was: answered 200 but dropped 3/,
        );
      },
    );
  });
});

describe("given a door that answers 200 and says what it dropped", () => {
  beforeEach(() => sendTo(new DemoStack(PROJECT_KEYS)));

  const dropped = [
    { path: "/api/otel/v1/traces", partialSuccess: { rejectedSpans: 2 } },
    { path: "/api/collector", partialSuccess: { rejectedEvaluations: 1 } },
    { path: "/api/otel/v1/logs", partialSuccess: { rejectedLogRecords: 4 } },
  ];

  /** @scenario "A door that drops data inside a 200 is a refusal" */
  it("counts a body with rejected spans, evaluations or log records as refused", async () => {
    for (const { path, partialSuccess } of dropped) {
      stack.answers.set(path, { status: 200, body: JSON.stringify({ partialSuccess }) });
    }
    const http = new DemoHttp({
      endpoint: ENDPOINT,
      apiKey: CARE ?? "",
      signal: new AbortController().signal,
    });

    for (const { path } of dropped) await http.sendAll({ path, bodies: [{}, {}] });
    await http.sendAll({ path: "/api/track_event", bodies: [{}, {}] });

    expect(http.failures).toBe(6);
  });
});

describe("given the trace door's own clock", () => {
  it("keeps the hour of traffic that has not happened yet out of a run", async () => {
    sendTo(new DemoStack(PROJECT_KEYS));
    await send(runAt({ days: 2 }));

    const newest = Math.max(
      ...[...stack.holdings(CARE ?? "").traces.values()].map((trace) => trace.startedAt),
    );
    expect(newest).toBeLessThanOrEqual(NOW);
    expect(NOW - newest).toBeLessThan(6 * HOUR_MS);
  });
});
