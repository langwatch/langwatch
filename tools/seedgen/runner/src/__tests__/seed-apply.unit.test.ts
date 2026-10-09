import { readFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";

import type { AuthzApi, AuthzAttachBindingsInput } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { HandledError } from "@langwatch/handled-error";
import type { LogApi } from "@langwatch/log-contract";
import type { MetricApi } from "@langwatch/metric-contract";
import { type BootedApplication, loadTaskModules } from "@langwatch/process";
import { Task } from "@langwatch/task";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import * as runner from "../index.ts";
import { seedActionSchema, seedReplySchema, type SeedReply } from "../protocol.ts";
import { SeedApplyTask } from "../seed-apply.task.ts";
import type { SeedApis } from "../seed-kinds.ts";

class SeedTestRefusal extends HandledError {
  declare readonly code: "seed_test_refusal";

  constructor() {
    super("seed_test_refusal", "refused for the test", { retryable: true });
  }
}

const grant = {
  principal: { userId: "user_1" },
  role: "ADMIN",
  scopeType: "ORGANIZATION",
  scopeId: "org_1",
};

function seedApis(overrides: Partial<{ [Name in keyof SeedApis]: SeedApis[Name] }> = {}): SeedApis {
  return {
    authz: createApiFixture<AuthzApi>({
      attachBindings: vi.fn(async ({ bindings }: AuthzAttachBindingsInput) => ({
        attached: bindings.map((binding) => binding.bindingId),
        duplicates: [],
      })),
    }),
    dataRetention: createApiFixture<DataRetentionApi>({ setForScope: vi.fn() }),
    trace: createApiFixture<TraceApi>({ otlpTraces: vi.fn(async () => ({})) }),
    log: createApiFixture<LogApi>({
      collectOtlpLogs: vi.fn(async () => ({
        outcome: "collected" as const,
        acceptedLogRecords: 1,
        rejectedLogRecords: 0,
      })),
    }),
    metric: createApiFixture<MetricApi>({
      collectOtlpMetrics: vi.fn(async () => ({
        outcome: "collected" as const,
        acceptedDataPoints: 1,
        rejectedDataPoints: 0,
      })),
    }),
    ...overrides,
  };
}

async function applyLines({
  lines,
  apis,
  args = [],
}: {
  lines: readonly unknown[];
  apis: SeedApis;
  args?: readonly string[];
}): Promise<SeedReply[]> {
  let written = "";
  const output = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  const input = Readable.from([
    lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n"),
  ]);
  await new SeedApplyTask({ apis, input, output }).run({
    args,
    signal: new AbortController().signal,
  });
  return written
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => seedReplySchema.parse(JSON.parse(line)));
}

describe("seed:apply", () => {
  /** @scenario "The seed:apply task loads by LANGWATCH_TASK_MODULES" */
  it("loads through the task-module loader and gets its Apis from the booted App", async () => {
    let resolved = 0;
    const service = <Api>(): Api => {
      resolved += 1;
      return createApiFixture<Api & object>();
    };
    const app = createApiFixture<BootedApplication>({ service });
    const tasks = await loadTaskModules({
      specifiers: ["@langwatch/seedgen-runner"],
      host: app,
      isTask: (contribution: unknown): contribution is Task => contribution instanceof Task,
      importModule: () => Promise.resolve(runner),
    });
    expect(tasks.map((task) => task.name)).toEqual(["seed:apply"]);
    expect(resolved).toBe(5);
  });

  /** @scenario "Each action kind calls its one module API operation" */
  it("calls one installed operation per kind and acknowledges each action", async () => {
    const apis = seedApis();
    const replies = await applyLines({
      apis,
      lines: [
        { id: "r/1", kind: "grant.attach", org: "org_1", input: { grants: [grant] } },
        {
          id: "r/2",
          kind: "retention.set",
          org: "org_1",
          input: { days: 49 },
        },
        {
          id: "r/3",
          kind: "trace.otlp",
          org: "org_1",
          project: "p_1",
          input: { resourceSpans: [] },
        },
        { id: "r/4", kind: "log.otlp", org: "org_1", project: "p_1", input: { resourceLogs: [] } },
        {
          id: "r/5",
          kind: "metric.otlp",
          org: "org_1",
          project: "p_1",
          input: { resourceMetrics: [] },
        },
      ],
    });

    expect(new Map(replies.map((reply) => [reply.id, reply.ok]))).toEqual(
      new Map([
        ["r/1", true],
        ["r/2", true],
        ["r/3", true],
        ["r/4", true],
        ["r/5", true],
      ]),
    );
    expect(apis.authz.attachBindings).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        caller: { type: "system" },
        actor: { type: "system", id: null },
        onDuplicate: "skip",
        bindings: [expect.objectContaining({ ...grant, customRoleId: null })],
      }),
    );
    expect(apis.dataRetention.setForScope).toHaveBeenCalledTimes(3);
    expect(apis.dataRetention.setForScope).toHaveBeenCalledWith({
      organizationId: "org_1",
      scope: { scopeType: "ORGANIZATION", scopeId: "org_1" },
      category: "traces",
      retentionDays: 49,
    });
    expect(apis.trace.otlpTraces).toHaveBeenCalledWith({
      tenantId: "p_1",
      traceRequest: { resourceSpans: [] },
    });
    expect(apis.log.collectOtlpLogs).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "p_1", organizationId: "org_1" }),
    );
    expect(apis.metric.collectOtlpMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "p_1", organizationId: "org_1" }),
    );
  });

  /** @scenario "Each action kind calls its one module API operation" */
  it("bounds a grant by the user it is attached as", async () => {
    const apis = seedApis();
    await applyLines({
      apis,
      lines: [
        { id: "r/1", kind: "grant.attach", org: "org_1", as: "user_0", input: { grants: [grant] } },
      ],
    });
    expect(apis.authz.attachBindings).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: { type: "user", id: "user_0" },
        actor: { type: "user", id: "user_0" },
      }),
    );
  });

  /** @scenario "An acknowledged grant returns its minted id as a reference" */
  it("returns a reference for each attached grant and none for a held one", async () => {
    const apis = seedApis({
      authz: createApiFixture<AuthzApi>({
        attachBindings: vi.fn(async ({ bindings }: AuthzAttachBindingsInput) => ({
          attached: bindings.slice(1).map((binding) => binding.bindingId),
          duplicates: bindings.slice(0, 1).map((binding) => binding.bindingId),
        })),
      }),
    });
    const [reply] = await applyLines({
      apis,
      lines: [
        {
          id: "r/1",
          kind: "grant.attach",
          org: "org_1",
          ref: "$grant:owner",
          input: { grants: [grant, grant] },
        },
      ],
    });
    expect(reply?.ok).toBe(true);
    expect(reply?.ok === true && Object.keys(reply.refs ?? {})).toEqual(["$grant:owner/1"]);
  });

  /** @scenario "A product refusal becomes a refusal line with its code" */
  it("turns a handled error into a refusal and carries on", async () => {
    const apis = seedApis({
      dataRetention: createApiFixture<DataRetentionApi>({
        setForScope: vi.fn(async () => {
          throw new SeedTestRefusal();
        }),
      }),
    });
    const replies = await applyLines({
      apis,
      lines: [
        {
          id: "r/1",
          kind: "retention.set",
          org: "org_1",
          input: { days: 49, scope: { scopeType: "PROJECT", scopeId: "p_1" }, category: "traces" },
        },
        {
          id: "r/2",
          kind: "trace.otlp",
          org: "org_1",
          project: "p_1",
          input: { resourceSpans: [] },
        },
      ],
      args: ["--concurrency", "1"],
    });
    expect(replies).toEqual([
      { id: "r/1", ok: false, code: "seed_test_refusal", retryable: true },
      { id: "r/2", ok: true },
    ]);
  });

  /** @scenario "Telemetry the ingest queue could not take is refused as retryable" */
  it("refuses a failed or unavailable telemetry export as retryable", async () => {
    const apis = seedApis({
      trace: createApiFixture<TraceApi>({
        otlpTraces: vi.fn(async () => ({ ingestionFailures: 2 })),
      }),
      log: createApiFixture<LogApi>({
        collectOtlpLogs: vi.fn(async () => ({
          outcome: "unavailable" as const,
          errorMessage: "down",
        })),
      }),
    });
    const replies = await applyLines({
      apis,
      lines: [
        {
          id: "r/1",
          kind: "trace.otlp",
          org: "org_1",
          project: "p_1",
          input: { resourceSpans: [] },
        },
        { id: "r/2", kind: "log.otlp", org: "org_1", project: "p_1", input: { resourceLogs: [] } },
      ],
      args: ["--concurrency", "1"],
    });
    expect(replies).toEqual([
      { id: "r/1", ok: false, code: "otlp_ingestion_failed", retryable: true },
      { id: "r/2", ok: false, code: "otlp_unavailable", retryable: true },
    ]);
  });

  /** @scenario "An unknown kind or malformed input is refused without calling any API" */
  it("refuses an unknown kind and a missing project without calling an Api", async () => {
    const apis = seedApis();
    const replies = await applyLines({
      apis,
      lines: [
        { id: "r/1", kind: "nosuch.kind", input: {} },
        { id: "r/2", kind: "trace.otlp", org: "org_1", input: { resourceSpans: [] } },
      ],
      args: ["--concurrency", "1"],
    });
    expect(replies).toEqual([
      { id: "r/1", ok: false, code: "unknown_seed_kind" },
      { id: "r/2", ok: false, code: "malformed_seed_action" },
    ]);
    expect(apis.trace.otlpTraces).not.toHaveBeenCalled();
  });

  /** @scenario "A line that is not a seed action stops the run naming the line" */
  it("fails naming the line for a non-action and for an unresolved ref", async () => {
    await expect(applyLines({ apis: seedApis(), lines: ["", '{"nope":1}'] })).rejects.toThrow(
      /line 2/,
    );
    await expect(
      applyLines({
        apis: seedApis(),
        lines: [
          { id: "r/1", kind: "trace.otlp", org: "$org:startup-1", project: "p_1", input: {} },
        ],
      }),
    ).rejects.toThrow(/line 1/);
  });

  /** @scenario "At most the configured number of actions are applied at once" */
  it("keeps at most --concurrency calls in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const apis = seedApis({
      trace: createApiFixture<TraceApi>({
        otlpTraces: vi.fn(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return {};
        }),
      }),
    });
    const lines = [1, 2, 3, 4, 5].map((n) => ({
      id: `r/${n}`,
      kind: "trace.otlp",
      org: "org_1",
      project: "p_1",
      input: { resourceSpans: [] },
    }));
    const replies = await applyLines({ apis, lines, args: ["--concurrency", "2"] });
    expect(replies).toHaveLength(5);
    expect(peak).toBe(2);
  });
});

const protocolFixture = (name: string): unknown[] =>
  readFileSync(new URL(`../../../testdata/protocol/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));

describe("the seedgen protocol fixtures", () => {
  /** @scenario "The runner reads and writes the protocol seedgen speaks" */
  it("round-trips every action and reply line through the runner's schemas", () => {
    const actions = protocolFixture("actions.ndjson");
    const replies = protocolFixture("replies.ndjson");
    expect(actions.length).toBeGreaterThan(0);
    expect(replies.length).toBeGreaterThan(0);
    for (const action of actions) expect(seedActionSchema.parse(action)).toEqual(action);
    for (const reply of replies) expect(seedReplySchema.parse(reply)).toEqual(reply);
  });
});
