import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import type { AuthzApi, AuthzAttachBindingsInput } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { HandledError } from "@langwatch/handled-error";
import type { LogApi } from "@langwatch/log-contract";
import type { MetricApi } from "@langwatch/metric-contract";
import type { FullyLoadedOrganization, OrganizationApi } from "@langwatch/organization-contract";
import { type BootedApplication, loadTaskModules } from "@langwatch/process";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { Task } from "@langwatch/task";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
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
    user: createApiFixture<UserApi>({
      findByEmail: vi.fn(async () => null),
      create: vi.fn(async ({ email }: { email: string }) => profileOf({ id: `user_${email}` })),
      setFirstPassword: vi.fn(async () => "set" as const),
    }),
    organization: createApiFixture<OrganizationApi>({
      getAllForUser: vi.fn(async () => []),
      createAndAssign: vi.fn(async () => ({
        organization: { id: "org_new", name: "acme" },
        team: { id: "team_new", slug: "acme", name: "acme" },
      })),
      createMembership: vi.fn(async () => ({
        outcome: "created" as const,
        seat: "MEMBER" as const,
        pending: false,
      })),
      changeMemberRole: vi.fn(async () => ({ teamsLeftWithoutAdmin: [] })),
      addTeamMember: vi.fn(async () => undefined),
    }),
    project: createApiFixture<ProjectApi>({
      listByTeam: vi.fn(async () => []),
      create: vi.fn(async () => projectOf({ id: "project_new", name: "support" })),
    }),
    ...overrides,
  };
}

const profileOf = (fields: Pick<UserProfile, "id">): UserProfile =>
  createApiFixture<UserProfile & object>(fields);
const projectOf = (fields: Pick<Project, "id" | "name">): Project =>
  createApiFixture<Project & object>(fields);

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
    expect(resolved).toBe(8);
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

  /** @scenario "Seeded users, orgs, projects and memberships go through the module APIs" */
  it("creates users, orgs, projects and memberships through the module APIs, as the owner", async () => {
    const apis = seedApis();
    const replies = await applyLines({
      apis,
      lines: [
        {
          id: "r/1",
          kind: "user.create",
          ref: "$user:acme/owner",
          key: "acme.u1@seed.test",
          input: { email: "acme.u1@seed.test", role: "ADMIN", state: "accepted" },
        },
        {
          id: "r/2",
          kind: "org.create",
          ref: "$org:acme",
          as: "user_1",
          input: { name: "acme", persona: "startup", team: "main" },
        },
        {
          id: "r/3",
          kind: "project.create",
          ref: "$project:acme/support",
          org: "org_new",
          as: "user_1",
          input: { name: "support", team: "team_new" },
        },
        {
          id: "r/4",
          kind: "member.add",
          org: "org_new",
          as: "user_1",
          input: { user: "user_2", role: "EXTERNAL", team: "team_new", teamRole: "VIEWER" },
        },
      ],
    });
    expect(new Map(replies.map((reply) => [reply.id, reply]))).toEqual(
      new Map([
        ["r/1", { id: "r/1", ok: true, refs: { "$user:acme/owner": "user_acme.u1@seed.test" } }],
        [
          "r/2",
          { id: "r/2", ok: true, refs: { "$org:acme": "org_new", "$team:acme/main": "team_new" } },
        ],
        ["r/3", { id: "r/3", ok: true, refs: { "$project:acme/support": "project_new" } }],
        ["r/4", { id: "r/4", ok: true }],
      ]),
    );
    expect(apis.organization.createAndAssign).toHaveBeenCalledWith(
      { orgName: "acme" },
      { id: "user_1" },
    );
    expect(apis.project.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_new", teamId: "team_new", name: "support" }),
      { id: "user_1" },
    );
    const owner = { type: "user", id: "user_1" };
    expect(apis.organization.createMembership).toHaveBeenCalledWith({
      organizationId: "org_new",
      userId: "user_2",
      seat: "MEMBER",
      admittedBy: { actor: owner, commandId: "r/4" },
    });
    expect(apis.organization.changeMemberRole).toHaveBeenCalledWith(
      { organizationId: "org_new", userId: "user_2", role: "EXTERNAL" },
      { id: "user_1" },
    );
    expect(apis.organization.addTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team_new",
        userId: "user_2",
        role: "VIEWER",
        caller: owner,
      }),
    );
  });

  /** @scenario "Seeded users, orgs, projects and memberships go through the module APIs" */
  it("finds what an earlier run created instead of creating it again", async () => {
    const organization = createApiFixture<FullyLoadedOrganization & object>({
      id: "org_old",
      name: "acme",
      teams: [
        createApiFixture<FullyLoadedOrganization["teams"][number] & object>({
          id: "team_old",
          isPersonal: false,
        }),
      ],
    });
    const apis = seedApis({
      user: createApiFixture<UserApi>({
        findByEmail: vi.fn(async () => profileOf({ id: "user_old" })),
        create: vi.fn(),
        setFirstPassword: vi.fn(async () => "already_set" as const),
      }),
      organization: createApiFixture<OrganizationApi>({
        getAllForUser: vi.fn(async () => [organization]),
        createAndAssign: vi.fn(),
      }),
      project: createApiFixture<ProjectApi>({
        listByTeam: vi.fn(async () => [projectOf({ id: "project_old", name: "support" })]),
        create: vi.fn(),
      }),
    });
    const replies = await applyLines({
      apis,
      lines: [
        {
          id: "r/1",
          kind: "user.create",
          ref: "$user:a",
          input: { email: "a@seed.test", role: "MEMBER", state: "accepted" },
        },
        {
          id: "r/2",
          kind: "org.create",
          ref: "$org:acme",
          as: "user_old",
          input: { name: "acme", team: "main" },
        },
        {
          id: "r/3",
          kind: "project.create",
          ref: "$project:p",
          org: "org_old",
          as: "user_old",
          input: { name: "support", team: "team_old" },
        },
      ],
    });
    expect(replies.flatMap((reply) => (reply.ok ? [reply.refs] : []))).toEqual(
      expect.arrayContaining([
        { "$user:a": "user_old" },
        { "$org:acme": "org_old", "$team:acme/main": "team_old" },
        { "$project:p": "project_old" },
      ]),
    );
    expect(apis.user.create).not.toHaveBeenCalled();
    expect(apis.organization.createAndAssign).not.toHaveBeenCalled();
    expect(apis.project.create).not.toHaveBeenCalled();
  });

  /** @scenario "Seeded users share one dev password" */
  it("sets the shared password hash on accepted users only", async () => {
    const apis = seedApis();
    let written = "";
    const output = new Writable({
      write(chunk, _encoding, done) {
        written += String(chunk);
        done();
      },
    });
    const line = (id: string, state: string) =>
      JSON.stringify({
        id,
        kind: "user.create",
        ref: `$user:${id}`,
        input: { email: `${id.replace("/", "")}@seed.test`, role: "MEMBER", state },
      });
    const hashFile = join(mkdtempSync(join(tmpdir(), "seed-apply-")), "password.hash");
    writeFileSync(hashFile, "$2b$10$hash\n");
    await new SeedApplyTask({
      apis,
      input: Readable.from([`${line("r/1", "accepted")}\n${line("r/2", "invited")}`]),
      output,
    }).run({ args: ["--password-hash-file", hashFile], signal: new AbortController().signal });
    expect(written.trim().split("\n")).toHaveLength(2);
    expect(apis.user.setFirstPassword).toHaveBeenCalledTimes(1);
    expect(apis.user.setFirstPassword).toHaveBeenCalledWith({
      id: "user_r1@seed.test",
      passwordHash: "$2b$10$hash",
    });
  });

  /** @scenario "The persona counts haven seed prints are what it created" */
  it("refuses a membership whose seat waits, so it is never counted", async () => {
    const apis = seedApis({
      organization: createApiFixture<OrganizationApi>({
        createMembership: vi.fn(async () => ({
          outcome: "created" as const,
          seat: "EXTERNAL" as const,
          pending: true,
        })),
        changeMemberRole: vi.fn(),
        addTeamMember: vi.fn(),
      }),
    });
    const [reply] = await applyLines({
      apis,
      lines: [
        {
          id: "r/1",
          kind: "member.add",
          org: "o",
          as: "u",
          input: { user: "v", role: "MEMBER", team: "t", teamRole: "MEMBER" },
        },
      ],
    });
    expect(reply).toEqual({ id: "r/1", ok: false, code: "seat_unavailable" });
    expect(apis.organization.addTeamMember).not.toHaveBeenCalled();
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
