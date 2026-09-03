import { DispatchError, isDispatchError } from "@langwatch/eventing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSettlementFixture,
  settlementContext,
  settlementSummary,
  settlementTrace,
  settlementTrigger,
} from "./support/settlement.fixtures";

const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
    error: vi.fn(),
  }),
}));

const datasetParams = {
  datasetId: "dataset-1",
  datasetMapping: { mapping: {}, expansions: [] },
};

function datasetTrigger() {
  return settlementTrigger("ADD_TO_DATASET", { actionParams: datasetParams });
}

function emailTrigger(id = "trigger-1") {
  return settlementTrigger("SEND_EMAIL", {
    id,
    actionParams: { members: ["ops@example.com"] },
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: "Alert: {{ trigger.name }}",
      emailBodyTemplate: "Matched {{ matches.size }} trace",
    },
  });
}

describe("AutomationSettlementDispatchService", () => {
  afterEach(() => {
    vi.useRealTimers();
    loggerWarn.mockClear();
  });

  it("records overflow only when the durable intent executes", async () => {
    const fixture = createSettlementFixture(datasetTrigger());

    await fixture.service.logOverflow(
      { triggerId: "trigger-1", flushed: 2, totalFlushed: 7 },
      settlementContext("process:trigger-1:overflow:1"),
    );

    expect(fixture.observability.overflows).toEqual([2]);
    expect(loggerWarn).toHaveBeenCalledWith(
      {
        projectId: "project-1",
        triggerId: "trigger-1",
        flushed: 2,
        totalFlushed: 7,
      },
      "Trigger settlement pending-match bound flushed oldest matches to immediate dispatch",
    );
  });

  it("confirms, renders, sends, and claims only eligible notification candidates", async () => {
    const fixture = createSettlementFixture(emailTrigger());
    fixture.traces.summaries.set("trace-filtered", settlementSummary("trace-filtered"));
    fixture.traces.records.set("trace-filtered", settlementTrace("trace-filtered"));
    fixture.traces.summaries.set("trace-claimed", settlementSummary("trace-claimed"));
    fixture.traces.records.set("trace-claimed", settlementTrace("trace-claimed"));
    fixture.confirmation.rejected.add("trace-filtered");
    fixture.automation.claimed.add("trace-claimed");

    await fixture.service.notifyDigest(
      {
        triggerId: "trigger-1",
        traceIds: ["trace-1", "trace-filtered", "trace-claimed"],
        boundary: 1_000,
      },
      settlementContext(),
    );

    expect(fixture.delivery.emails).toHaveLength(1);
    expect(fixture.delivery.emails[0]).toMatchObject({
      recipients: ["ops@example.com"],
      subject: "Alert: Settlement test",
    });
    expect(fixture.delivery.emails[0]?.html).toContain("Matched 1 trace");
    expect(fixture.automation.claims).toEqual([
      { triggerId: "trigger-1", traceId: "trace-1", projectId: "project-1" },
    ]);
    expect(fixture.automation.lastRuns).toEqual([
      { triggerId: "trigger-1", projectId: "project-1" },
    ]);
  });

  it("keeps tenant email cap claims distinct for triggers sharing a digest", async () => {
    const fixture = createSettlementFixture(emailTrigger("trigger-a"));

    await fixture.service.notifyDigest(
      { triggerId: "trigger-a", traceIds: ["trace-1"], boundary: 1_000 },
      settlementContext("process:trigger-a:digest:1000:batch"),
    );
    fixture.automation.activeTrigger = emailTrigger("trigger-b");
    fixture.automation.claimed.clear();
    await fixture.service.notifyDigest(
      { triggerId: "trigger-b", traceIds: ["trace-1"], boundary: 1_000 },
      settlementContext("process:trigger-b:digest:1000:batch"),
    );

    const dailyClaims = fixture.emailCapStore.claimKeys.filter((key) =>
      key.includes("tenant-cap-claimed"),
    );
    expect(dailyClaims).toHaveLength(2);
    expect(dailyClaims[0]).toContain("trigger-a");
    expect(dailyClaims[1]).toContain("trigger-b");
    expect(dailyClaims[0]).not.toBe(dailyClaims[1]);
  });

  it("suppresses a notification already claimed in an earlier settlement window", async () => {
    const fixture = createSettlementFixture(emailTrigger());
    const payload = { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 31_000 };

    await fixture.service.notifyDigest(payload, settlementContext("digest:first"));
    await fixture.service.notifyDigest(
      { ...payload, boundary: 61_000 },
      settlementContext("digest:second"),
    );

    expect(fixture.delivery.emails).toHaveLength(1);
    expect(fixture.automation.claims).toHaveLength(1);
  });

  it("supports the legacy single-trace persist intent and claims after writing", async () => {
    const fixture = createSettlementFixture(datasetTrigger());

    await fixture.service.persistMatch(
      { triggerId: "trigger-1", traceId: "trace-1" },
      settlementContext("persist:trace-1"),
    );

    expect(fixture.writer.datasetWrites).toHaveLength(1);
    expect(fixture.automation.claims).toEqual([
      { triggerId: "trigger-1", traceId: "trace-1", projectId: "project-1" },
    ]);
  });

  it("consumes the resolved ceiling only after settlement confirmation", async () => {
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.automation.persistCap = 37;

    await fixture.service.persistMatch(
      { triggerId: "trigger-1", traceId: "trace-1" },
      settlementContext("persist:trace-1"),
    );

    expect(fixture.automation.capInputs).toEqual([
      expect.objectContaining({
        projectId: "project-1",
        triggerId: "trigger-1",
        cap: 37,
        dedupKey: "project-1/trigger-1:persist:trace-1",
      }),
    ]);
    expect(fixture.writer.datasetWrites).toHaveLength(1);
  });

  it("does not consume a ceiling slot when settled filters reject the trace", async () => {
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.confirmation.rejected.add("trace-1");

    await fixture.service.persistMatch(
      { triggerId: "trigger-1", traceId: "trace-1" },
      settlementContext("persist:trace-1"),
    );

    expect(fixture.automation.capInputs).toEqual([]);
    expect(fixture.writer.datasetWrites).toEqual([]);
  });

  it("drops over-ceiling matches terminally and contains once per page", async () => {
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.automation.persistDecision = {
      allowed: false,
      count: 101,
      cap: 100,
      skipped: 1,
    };

    await expect(
      fixture.service.persistMatch(
        { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
        settlementContext("persist:page-1"),
      ),
    ).resolves.toBeUndefined();

    expect(fixture.writer.datasetWrites).toEqual([]);
    expect(fixture.automation.claims).toEqual([]);
    expect(fixture.automation.breachInputs).toHaveLength(1);
  });

  it("does not retry a dropped dispatch when breach containment fails", async () => {
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.automation.persistDecision = {
      allowed: false,
      count: 101,
      cap: 100,
      skipped: 1,
    };
    fixture.automation.breachError = new Error("mailer down");

    await expect(
      fixture.service.persistMatch(
        { triggerId: "trigger-1", traceId: "trace-1" },
        settlementContext("persist:trace-1"),
      ),
    ).resolves.toBeUndefined();
    expect(fixture.observability.captures).toEqual([
      expect.objectContaining({
        extra: expect.objectContaining({ phase: "persist-cap-breach" }),
      }),
    ]);
  });

  it("dispatches during a later settlement window when the trace then confirms", async () => {
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.confirmation.rejected.add("trace-1");

    await fixture.service.persistMatch(
      { triggerId: "trigger-1", traceId: "trace-1" },
      settlementContext("persist:first-window"),
    );
    fixture.confirmation.rejected.delete("trace-1");
    await fixture.service.persistMatch(
      { triggerId: "trigger-1", traceId: "trace-1" },
      settlementContext("persist:second-window"),
    );

    expect(fixture.writer.datasetWrites).toHaveLength(1);
    expect(fixture.automation.claims).toHaveLength(1);
  });

  it("dispatches bounded pages with fixed reads once and retries only unclaimed traces", async () => {
    const fixture = createSettlementFixture(datasetTrigger());
    const payload = { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] };

    await fixture.service.persistMatch(payload, settlementContext("persist:page-1"));

    expect(fixture.writer.datasetWrites).toHaveLength(2);
    expect(fixture.automation.activeTriggerReads).toBe(1);
    expect(fixture.automation.persistCapReads).toBe(1);
    expect(fixture.projects.reads).toBe(1);
    fixture.automation.claimed.delete("trace-2");
    await fixture.service.persistMatch(payload, {
      ...settlementContext("persist:page-1"),
      attempt: 2,
    });
    expect(fixture.writer.datasetWrites).toHaveLength(3);
    expect(fixture.automation.claims.at(-1)?.traceId).toBe("trace-2");
  });

  it("captures a terminal trace failure without blocking page-mates", async () => {
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.writer.errors.set(
      "trace-1",
      new DispatchError({ message: "dataset gone", retryable: false }),
    );

    await expect(
      fixture.service.persistMatch(
        { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
        settlementContext("persist:page-1"),
      ),
    ).resolves.toBeUndefined();

    expect(fixture.automation.claims.map(({ traceId }) => traceId)).toEqual(["trace-2"]);
    expect(fixture.observability.captures).toContainEqual(
      expect.objectContaining({
        extra: expect.objectContaining({
          traceId: "trace-1",
          phase: "persist-dispatch-terminal",
        }),
      }),
    );
  });

  it("finishes page-mates before rethrowing a retryable trace failure", async () => {
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.writer.errors.set(
      "trace-1",
      new DispatchError({ message: "database unavailable", retryable: true }),
    );

    const thrown = await fixture.service
      .persistMatch(
        { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
        settlementContext("persist:page-1"),
      )
      .catch((error: unknown) => error);

    expect(isDispatchError(thrown)).toBe(true);
    expect(fixture.automation.claims.map(({ traceId }) => traceId)).toEqual(["trace-2"]);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: "DispatchError",
        errorMessage: "database unavailable",
      }),
      "Persist page had retryable failures. Retrying the page; claimed traces no-op on the retry",
    );
  });

  it("treats an unclassified trace failure as retryable", async () => {
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.writer.errors.set("trace-1", new Error("connection reset"));

    const thrown = await fixture.service
      .persistMatch(
        { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
        settlementContext("persist:page-1"),
      )
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect(isDispatchError(thrown)).toBe(false);
    expect(fixture.automation.claims.map(({ traceId }) => traceId)).toEqual(["trace-2"]);
  });

  it("deduplicates repeated trace ids inside a persist page", async () => {
    const fixture = createSettlementFixture(datasetTrigger());

    await fixture.service.persistMatch(
      { triggerId: "trigger-1", traceIds: ["trace-1", "trace-1"] },
      settlementContext("persist:page-1"),
    );

    expect(fixture.writer.datasetWrites).toHaveLength(1);
    expect(fixture.automation.claims).toHaveLength(1);
  });

  it("retries a page when a side effect lost its claim and a page-mate failed retryably", async () => {
    vi.useFakeTimers();
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.automation.claimFailures = 3;
    fixture.writer.errors.set(
      "trace-2",
      new DispatchError({ message: "database unavailable", retryable: true }),
    );

    const result = fixture.service.persistMatch(
      { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
      settlementContext("persist:page-1"),
    );
    await vi.runAllTimersAsync();
    const thrown = await result.catch((error: unknown) => error);

    expect(isDispatchError(thrown)).toBe(true);
    expect(fixture.writer.datasetWrites).toHaveLength(1);
    expect(fixture.automation.claims).toHaveLength(3);
    expect(fixture.observability.captures).toContainEqual(
      expect.objectContaining({
        extra: expect.objectContaining({ phase: "persist-page-retry-unclaimed" }),
      }),
    );
  });

  it("claims on an inline retry so only the failed page trace runs on redelivery", async () => {
    vi.useFakeTimers();
    const fixture = createSettlementFixture(datasetTrigger());
    fixture.automation.claimFailures = 1;
    fixture.writer.errors.set(
      "trace-2",
      new DispatchError({ message: "database unavailable", retryable: true }),
    );
    const payload = { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] };

    const first = fixture.service.persistMatch(payload, settlementContext("persist:page-1"));
    await vi.runAllTimersAsync();
    await first.catch(() => void 0);
    expect(fixture.automation.claimed.has("trace-1")).toBe(true);
    fixture.writer.errors.clear();
    fixture.writer.datasetWrites.length = 0;
    await fixture.service.persistMatch(payload, {
      ...settlementContext("persist:page-1"),
      attempt: 2,
    });

    expect(fixture.writer.datasetWrites).toHaveLength(1);
    expect(fixture.automation.claims.at(-1)?.traceId).toBe("trace-2");
  });

  it("keeps webhook event ids stable across retries of the same outbox message", async () => {
    const trigger = settlementTrigger("SEND_WEBHOOK", {
      actionParams: {
        url: "https://example.com/hook",
        method: "POST",
        bodyTemplate: '{"count": {{ matches.size }}}',
      },
    });
    const fixture = createSettlementFixture(trigger);
    const payload = {
      triggerId: "trigger-1",
      traceIds: ["trace-1", "trace-2"],
      boundary: 1_000,
    };
    const context = settlementContext("process:trigger-1:digest:1000:stable-batch");

    await fixture.service.notifyDigest(payload, context);
    fixture.automation.claimed.delete("trace-2");
    await fixture.service.notifyDigest(payload, { ...context, attempt: 2 });

    expect(fixture.delivery.webhooks).toHaveLength(2);
    expect(fixture.delivery.webhooks[0]?.eventId).toBe(fixture.delivery.webhooks[1]?.eventId);
  });
});
