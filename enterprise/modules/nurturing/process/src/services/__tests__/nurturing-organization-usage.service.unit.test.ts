// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The daily usage sync over nurturing's memory stores and recording owners.
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/organization-usage.feature
 */
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi, TraceUsageSummary } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { HttpCustomerIoChannel } from "../../channels/http/http.customer-io.channel.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingClaimRepository } from "../../repositories/nurturing-claim.repository.ts";
import { NurturingOrganizationUsageService } from "../nurturing-organization-usage.service.ts";
import { NurturingService } from "../nurturing.service.ts";

const logged = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: logged.error, debug: vi.fn() }),
  createWarnThrottle: () => ({ claim: () => 0, reset: () => {} }),
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 6, 5, 10);
const seconds = (ms: number) => Math.floor(ms / 1000);

/** The exact trait keys a group call may carry. */
const USAGE_TRAIT_KEYS = [
  "prompt_count",
  "evaluator_count",
  "scenario_count",
  "trace_count",
  "error_count",
  "total_cost",
  "last_failed_trace_at",
];

const NO_TRACES: TraceUsageSummary = {
  traces: 0,
  errors: 0,
  totalCost: 0,
  lastFailedTraceAt: null,
};

type Project = Readonly<{
  id: string;
  evaluators?: number;
  scenarios?: number;
  traces?: TraceUsageSummary;
  archived?: boolean;
}>;

type Organization = Readonly<{
  id: string;
  admin?: string | null;
  prompts?: number;
  projects?: readonly Project[];
  /** When its row was written; defaults to the day before the sync. */
  writtenAt?: number;
  lastTraceAt?: number;
}>;

type GroupCall = { type: string; userId: string; groupId: string; traits: Record<string, unknown> };

/** Customer.io over a fetch answering each batch with the next status; a taken batch is kept. */
function customerIo(statuses: number[]) {
  const batches: GroupCall[][] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const status = statuses.shift() ?? 200;
    if (status < 300) batches.push(JSON.parse(init?.body as string).batch);
    return new Response(null, { status });
  });
  const service = NurturingService.create({
    channel: HttpCustomerIoChannel.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn,
    }),
  });
  return { service, batches, groups: () => batches.flat() };
}

/** Organizations recorded at their own times, owners answering from the projects they hold. */
async function syncOver(
  organizations: readonly Organization[],
  {
    statuses = [],
    failingProjects = new Set<string>(),
    claims = MemoryNurturingClaimRepository.create(),
  }: {
    statuses?: number[];
    failingProjects?: Set<string>;
    claims?: NurturingClaimRepository;
  } = {},
) {
  const clock = { at: NOW - DAY_MS };
  const milestones = MemoryNurturingMilestonesRepository.create({ nowMs: () => clock.at });
  for (const organization of organizations) {
    clock.at = organization.writtenAt ?? NOW - DAY_MS;
    await milestones.recordOrganization({
      organizationId: organization.id,
      adminUserId:
        organization.admin === undefined ? `admin-of-${organization.id}` : organization.admin,
      seeded: false,
    });
    if (organization.lastTraceAt !== undefined) {
      await milestones.recordLastTrace({
        organizationId: organization.id,
        occurredAt: organization.lastTraceAt,
      });
    }
  }
  const projects = organizations.flatMap((organization) =>
    (organization.projects ?? []).map((project) => ({
      ...project,
      organizationId: organization.id,
    })),
  );
  const projectsOf = (projectIds: readonly string[]) =>
    projects.filter((project) => projectIds.includes(project.id));
  const readOrganizations: string[] = [];
  const traceReads: { projectIds: readonly string[]; since: number }[] = [];

  const prompts = createApiFixture<PromptApi>({
    countOrganizationVersionedPrompts: async ({ organizationId }) => {
      readOrganizations.push(organizationId);
      return organizations.find(({ id }) => id === organizationId)?.prompts ?? 0;
    },
  });
  const evaluators = createApiFixture<EvaluatorApi>({
    countActiveForProjects: async ({ projectIds }) =>
      projectsOf(projectIds).reduce((sum, project) => sum + (project.evaluators ?? 0), 0),
  });
  const scenarios = createApiFixture<ScenarioApi>({
    countActiveForProjects: async ({ projectIds }) =>
      projectsOf(projectIds).reduce((sum, project) => sum + (project.scenarios ?? 0), 0),
  });
  const traces = createApiFixture<TraceApi>({
    summarizeUsage: async (input) => {
      traceReads.push(input);
      if (input.projectIds.some((projectId) => failingProjects.has(projectId))) {
        throw new Error("ClickHouse unavailable");
      }
      return projectsOf(input.projectIds).reduce<TraceUsageSummary>((sum, project) => {
        const own = project.traces ?? NO_TRACES;
        const failedAts = [sum.lastFailedTraceAt, own.lastFailedTraceAt].flatMap((value) =>
          value === null ? [] : [value],
        );
        return {
          traces: sum.traces + own.traces,
          errors: sum.errors + own.errors,
          totalCost: sum.totalCost + own.totalCost,
          lastFailedTraceAt: failedAts.length > 0 ? Math.max(...failedAts) : null,
        };
      }, NO_TRACES);
    },
  });
  const cio = customerIo(statuses);
  const service = NurturingOrganizationUsageService.create({
    organizations: milestones,
    projects: MemoryNurturingProjectDirectoryRepository.create({
      placed: new Map(projects.map((project) => [project.id, project.organizationId])),
      archived: new Set(projects.filter(({ archived }) => archived).map(({ id }) => id)),
    }),
    claims,
    customerIo: cio.service,
    prompts,
    evaluators,
    scenarios,
    traces,
  });
  return { service, cio, readOrganizations, traceReads };
}

describe("NurturingOrganizationUsageService", () => {
  describe("given an organization with 2 prompts, 1 evaluator, no scenarios and 3 traces, 1 failed", () => {
    const failedAt = NOW - 2 * DAY_MS + 750;
    const organization: Organization = {
      id: "org-1",
      admin: "admin-1",
      prompts: 2,
      lastTraceAt: NOW - DAY_MS,
      projects: [
        {
          id: "project-a",
          evaluators: 1,
          traces: { traces: 2, errors: 1, totalCost: 0.25, lastFailedTraceAt: failedAt },
        },
        {
          id: "project-b",
          traces: { traces: 1, errors: 0, totalCost: 0.5, lastFailedTraceAt: null },
        },
      ],
    };

    /** @scenario An active organization's usage reaches Customer.io as one group call */
    it("sends one group call to its admin with the counts and the failed time in seconds", async () => {
      const { service, cio } = await syncOver([organization]);

      await service.syncAll({ now: NOW });

      expect(cio.groups()).toEqual([
        {
          type: "group",
          userId: "admin-1",
          groupId: "org-1",
          traits: {
            prompt_count: 2,
            evaluator_count: 1,
            scenario_count: 0,
            trace_count: 3,
            error_count: 1,
            total_cost: 0.75,
            last_failed_trace_at: seconds(failedAt),
          },
        },
      ]);
    });

    /** @scenario Traces are summed over every project of the organization, over the last 30 days */
    it("reads the traces of both projects since 30 days before the sync", async () => {
      const { service, traceReads } = await syncOver([organization]);

      await service.syncAll({ now: NOW });

      expect(traceReads).toEqual([
        { projectIds: ["project-a", "project-b"], since: NOW - 30 * DAY_MS },
      ]);
    });

    /** @scenario The group call carries only the usage traits */
    it("sends no trait outside the usage allowlist", async () => {
      const { service, cio } = await syncOver([organization]);

      await service.syncAll({ now: NOW });

      expect(Object.keys(cio.groups()[0]?.traits ?? {}).toSorted()).toEqual(
        USAGE_TRAIT_KEYS.toSorted(),
      );
    });

    /** @scenario A sync that already ran today sends nothing more */
    it("sends nothing more when the day's sync runs again", async () => {
      const { service, cio } = await syncOver([organization]);

      await service.syncAll({ now: NOW });
      await service.syncAll({ now: NOW + 60 * 60 * 1000 });

      expect(cio.groups()).toHaveLength(1);
    });
  });

  describe("given an organization with nothing", () => {
    /** @scenario An organization with nothing gets zeros */
    it("sends zeros and no failed time", async () => {
      const { service, cio } = await syncOver([{ id: "org-empty" }]);

      await service.syncAll({ now: NOW });

      expect(cio.groups()).toEqual([
        {
          type: "group",
          userId: "admin-of-org-empty",
          groupId: "org-empty",
          traits: {
            prompt_count: 0,
            evaluator_count: 0,
            scenario_count: 0,
            trace_count: 0,
            error_count: 0,
            total_cost: 0,
          },
        },
      ]);
    });
  });

  describe("given rows active and not in the last 30 days", () => {
    const old = NOW - 31 * DAY_MS;
    const organizations: Organization[] = [
      { id: "org-old-trace", lastTraceAt: old },
      { id: "org-recent-trace", writtenAt: old, lastTraceAt: NOW - DAY_MS },
      { id: "org-new" },
      { id: "org-old-row", writtenAt: old },
      { id: "org-no-admin", admin: null },
    ];

    /** @scenario Only organizations active in the last 30 days and with an admin are read */
    it("reads and sends only the organizations with an admin and a recent trace or a recent row", async () => {
      const { service, cio, readOrganizations } = await syncOver(organizations);

      await service.syncAll({ now: NOW });

      expect(cio.groups().map(({ groupId }) => groupId)).toEqual(["org-new", "org-recent-trace"]);
      expect(readOrganizations.toSorted()).toEqual(["org-new", "org-recent-trace"]);
    });
  });

  describe("given an organization whose only activity is the daily syncs", () => {
    /** @scenario The sync never keeps an organization active on its own */
    it("drops out once its row is older than 30 days, as the sync never writes it", async () => {
      const { service, cio } = await syncOver([{ id: "org-quiet", writtenAt: NOW - DAY_MS }]);

      await service.syncAll({ now: NOW });
      await service.syncAll({ now: NOW + 29 * DAY_MS });
      await service.syncAll({ now: NOW + 31 * DAY_MS });

      expect(cio.groups()).toHaveLength(2);
    });
  });

  describe("given an organization with a live project and an archived one", () => {
    /** @scenario Archived projects are not counted */
    it("counts only the live project's usage", async () => {
      const { service, cio, traceReads } = await syncOver([
        {
          id: "org-archive",
          projects: [
            { id: "project-live", traces: { ...NO_TRACES, traces: 1 } },
            {
              id: "project-archived",
              archived: true,
              evaluators: 2,
              scenarios: 3,
              traces: { traces: 5, errors: 1, totalCost: 2, lastFailedTraceAt: NOW - DAY_MS },
            },
          ],
        },
      ]);

      await service.syncAll({ now: NOW });

      expect(traceReads.map(({ projectIds }) => projectIds)).toEqual([["project-live"]]);
      expect(cio.groups()[0]?.traits).toMatchObject({
        evaluator_count: 0,
        scenario_count: 0,
        trace_count: 1,
        error_count: 0,
        total_cost: 0,
      });
    });
  });

  describe("given one organization's ClickHouse read fails", () => {
    const organizations: Organization[] = [
      { id: "org-bad", projects: [{ id: "project-bad" }] },
      { id: "org-good", projects: [{ id: "project-good" }] },
    ];

    /** @scenario A failed read for one organization does not stop the others */
    it("still sends the others, gives that claim back, logs it with the organization and fails", async () => {
      const failingProjects = new Set(["project-bad"]);
      const { service, cio } = await syncOver(organizations, { failingProjects });

      await expect(service.syncAll({ now: NOW })).rejects.toThrow("not synced");

      expect(cio.groups().map(({ groupId }) => groupId)).toEqual(["org-good"]);
      expect(logged.error).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-bad", error: expect.any(Error) }),
        expect.stringContaining("could not be read"),
      );

      failingProjects.clear();
      await service.syncAll({ now: NOW });

      expect(cio.groups().map(({ groupId }) => groupId)).toEqual(["org-good", "org-bad"]);
    });
  });

  describe("given Customer.io refuses a page's batch", () => {
    /** @scenario A refused batch gives its claims back so the retry sends them */
    it("gives the page's claims back and the next attempt sends them", async () => {
      const { service, cio } = await syncOver([{ id: "org-1" }, { id: "org-2" }], {
        statuses: [500],
      });

      await expect(service.syncAll({ now: NOW })).rejects.toThrow("not synced");
      expect(cio.groups()).toEqual([]);

      await service.syncAll({ now: NOW });

      expect(cio.groups().map(({ groupId }) => groupId)).toEqual(["org-1", "org-2"]);
    });
  });

  describe("given the claim for a page's second organization is rejected", () => {
    /** @scenario A rejected claim gives the page's earlier claims back */
    it("gives the first organization's claim back and fails with the rejection", async () => {
      const memory = MemoryNurturingClaimRepository.create();
      const released: string[] = [];
      const redis = { down: true };
      const claims: NurturingClaimRepository = {
        claim: async (key, ttlSeconds) => {
          if (redis.down && key.includes("org-2")) throw new Error("redis down");
          return memory.claim(key, ttlSeconds);
        },
        release: async (key) => {
          released.push(key);
          await memory.release(key);
        },
      };
      const { service, cio } = await syncOver([{ id: "org-1" }, { id: "org-2" }], { claims });

      await expect(service.syncAll({ now: NOW })).rejects.toThrow("redis down");

      expect(released).toEqual(["nurturing:organization_usage:org-1:2026-11-06"]);
      expect(cio.groups()).toEqual([]);

      redis.down = false;
      await service.syncAll({ now: NOW });

      expect(cio.groups().map(({ groupId }) => groupId)).toEqual(["org-1", "org-2"]);
    });
  });

  describe("given 250 qualifying organizations", () => {
    /** @scenario Every qualifying organization gets exactly one group call */
    it("sends each exactly one group call, in pages of 100", async () => {
      const ids = Array.from(
        { length: 250 },
        (_, index) => `org-${String(index).padStart(3, "0")}`,
      );
      const { service, cio } = await syncOver(ids.map((id) => ({ id })));

      await service.syncAll({ now: NOW });

      expect(cio.batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
      expect(cio.groups().map(({ groupId }) => groupId)).toEqual(ids);
    });
  });
});
