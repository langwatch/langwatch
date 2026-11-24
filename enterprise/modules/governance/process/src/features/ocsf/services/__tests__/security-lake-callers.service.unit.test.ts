// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PROJECT_KIND } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { GovernanceOcsfEvent } from "../../../../repositories/governance.repositories.ts";
import { MemoryOcsfEventsRepository } from "../../../../repositories/memory/memory.ocsf-events.repository.ts";
import {
  SecurityLakeCallersService,
  TRACE_AWS_PRINCIPAL_ATTRIBUTE,
  TRACE_LOOKUP_CONCURRENCY,
} from "../security-lake-callers.service.ts";

const GOV = "gov_project";
const TRACED = "arn:aws:iam::123456789012:role/traced-agent";
const UNTRACED = "arn:aws:iam::123456789012:role/agent";

function lakeEvent(
  id: string,
  principal: string,
  model: string,
  region: string,
): GovernanceOcsfEvent {
  return {
    tenantId: GOV,
    eventId: id,
    traceId: "",
    sourceId: "src_1",
    sourceType: "security_lake",
    activityId: 1,
    severityId: 1,
    eventTime: nowInstant(),
    actorUserId: "",
    actorEmail: "",
    actorEnduserId: "",
    actionName: "InvokeModel",
    targetName: model,
    anomalyAlertId: "",
    rawOcsfJson: JSON.stringify({ actor: { session: { issuer: principal } }, cloud: { region } }),
  };
}

const UNRELATED = "arn:aws:iam::123456789012:role/unrelated-agent";

/** A service over several projects, each answering one traced principal. */
function callersServiceOver({
  events,
  projectIds,
  traceIn,
}: {
  events: MemoryOcsfEventsRepository;
  projectIds: string[];
  traceIn: (input: { projectId: string }) => string;
}): SecurityLakeCallersService {
  return SecurityLakeCallersService.create({
    events,
    projects: {
      findInternal: async ({ kind }) =>
        (kind === PROJECT_KIND.INTERNAL_GOVERNANCE ? { id: GOV } : null) as never,
      findLiveNonGovernanceIdsByOrganization: async () => projectIds,
    },
    traces: {
      countAttributedTracesByValue: async ({ projectId }) => [
        { value: traceIn({ projectId }), count: 1 },
      ],
    },
  });
}

describe("SecurityLakeCallersService", () => {
  describe("when one principal sends traces and another does not", () => {
    /** @scenario A principal that calls Bedrock and sends no traces is listed as a caller without traces */
    it("lists only the principal without traces, with its models and Regions", async () => {
      const events = new MemoryOcsfEventsRepository();
      await events.insertEvents([
        lakeEvent("e1", UNTRACED, "anthropic.claude-v5", "eu-central-1"),
        lakeEvent("e2", UNTRACED, "amazon.nova-pro", "us-east-1"),
        lakeEvent("e3", TRACED, "anthropic.claude-v5", "eu-central-1"),
      ]);
      const asked: string[] = [];
      const service = SecurityLakeCallersService.create({
        events,
        projects: {
          findInternal: async ({ kind }) =>
            (kind === PROJECT_KIND.INTERNAL_GOVERNANCE ? { id: GOV } : null) as never,
          findLiveNonGovernanceIdsByOrganization: async () => ["p_1"],
        },
        traces: {
          countAttributedTracesByValue: async ({ valueKey, values }) => {
            asked.push(valueKey);
            return values.map((value) => ({ value, count: value === TRACED ? 3 : 0 }));
          },
        },
      });

      const { callers } = await service.withoutTraces({ organizationId: "org_1" });

      expect(asked).toEqual([TRACE_AWS_PRINCIPAL_ATTRIBUTE]);
      expect(callers.map((caller) => caller.principalArn)).toEqual([UNTRACED]);
      expect(callers[0]?.models.toSorted()).toEqual(["amazon.nova-pro", "anthropic.claude-v5"]);
      expect(callers[0]?.regions.toSorted()).toEqual(["eu-central-1", "us-east-1"]);
      expect(callers[0]?.callCount).toBe(2);
    });
  });

  describe("when the trace names another session or the IAM form of the role", () => {
    it.each([
      ["another session", "arn:aws:sts::123456789012:assumed-role/traced-agent/sessionB"],
      ["the IAM role", "arn:aws:iam::123456789012:role/traced-agent"],
      ["the IAM role with a path", "arn:aws:iam::123456789012:role/agents/claims/traced-agent"],
    ])("drops the caller when the trace carries %s", async (_, traceArn) => {
      const events = new MemoryOcsfEventsRepository();
      await events.insertEvents([
        lakeEvent(
          "e1",
          "arn:aws:sts::123456789012:assumed-role/traced-agent/sessionA",
          "m1",
          "eu-west-1",
        ),
        lakeEvent("e2", "arn:aws:sts::123456789012:assumed-role/other/sessionA", "m1", "eu-west-1"),
      ]);
      const service = SecurityLakeCallersService.create({
        events,
        projects: {
          findInternal: async ({ kind }) =>
            (kind === PROJECT_KIND.INTERNAL_GOVERNANCE ? { id: GOV } : null) as never,
          findLiveNonGovernanceIdsByOrganization: async () => ["p_1"],
        },
        traces: {
          countAttributedTracesByValue: async ({ values, valuePrefixes = [] }) => {
            const exact = values.includes(traceArn);
            const byPrefix = valuePrefixes.some((prefix) => traceArn.startsWith(prefix));
            return exact || byPrefix ? [{ value: traceArn, count: 1 }] : [];
          },
        },
      });

      const { callers } = await service.withoutTraces({ organizationId: "org_1" });

      expect(callers.map((caller) => caller.principalArn)).toEqual([
        "arn:aws:sts::123456789012:assumed-role/other/sessionA",
      ]);
    });
  });

  describe("when a trace names another role of the same account under a path", () => {
    it("keeps every caller, since the account-wide prefix only widens the lookup", async () => {
      const events = new MemoryOcsfEventsRepository();
      const caller = "arn:aws:sts::123456789012:assumed-role/traced-agent/sessionA";
      await events.insertEvents([lakeEvent("e1", caller, "m1", "eu-west-1")]);
      const traceArn = "arn:aws:iam::123456789012:role/agents/unrelated-agent";
      const service = SecurityLakeCallersService.create({
        events,
        projects: {
          findInternal: async ({ kind }) =>
            (kind === PROJECT_KIND.INTERNAL_GOVERNANCE ? { id: GOV } : null) as never,
          findLiveNonGovernanceIdsByOrganization: async () => ["p_1"],
        },
        traces: {
          countAttributedTracesByValue: async ({ valuePrefixes = [] }) =>
            valuePrefixes.some((prefix) => traceArn.startsWith(prefix))
              ? [{ value: traceArn, count: 1 }]
              : [],
        },
      });

      const { callers } = await service.withoutTraces({ organizationId: "org_1" });

      expect(callers.map((row) => row.principalArn)).toEqual([caller]);
    });
  });

  describe("when unrelated roles of the account are traced in the first projects", () => {
    it("keeps looking until the caller's own trace is found", async () => {
      const events = new MemoryOcsfEventsRepository();
      const caller = "arn:aws:sts::123456789012:assumed-role/traced-agent/sessionA";
      await events.insertEvents([lakeEvent("e1", caller, "m1", "eu-west-1")]);
      const projectIds = ["p_1", "p_2", "p_3", "p_4", "p_5"];
      const service = callersServiceOver({
        events,
        projectIds,
        traceIn: ({ projectId }) =>
          projectId === "p_5" ? "arn:aws:iam::123456789012:role/traced-agent" : UNRELATED,
      });

      const { callers } = await service.withoutTraces({ organizationId: "org_1" });

      expect(callers).toEqual([]);
    });
  });

  describe("when Security Lake sees assumed-role sessions of a role the trace names", () => {
    it("drops the traced role and folds the sessions of the untraced one", async () => {
      const events = new MemoryOcsfEventsRepository();
      await events.insertEvents([
        lakeEvent(
          "e1",
          "arn:aws:sts::123456789012:assumed-role/traced-agent/s-1",
          "m1",
          "eu-west-1",
        ),
        lakeEvent("e2", "arn:aws:sts::123456789012:assumed-role/agent/s-1", "m1", "eu-west-1"),
        lakeEvent("e3", "arn:aws:sts::123456789012:assumed-role/agent/s-2", "m2", "us-east-1"),
      ]);
      const service = SecurityLakeCallersService.create({
        events,
        projects: {
          findInternal: async ({ kind }) =>
            (kind === PROJECT_KIND.INTERNAL_GOVERNANCE ? { id: GOV } : null) as never,
          findLiveNonGovernanceIdsByOrganization: async () => ["p_1"],
        },
        traces: {
          countAttributedTracesByValue: async ({ values }) =>
            values.map((value) => ({ value, count: value === TRACED ? 1 : 0 })),
        },
      });

      const { callers } = await service.withoutTraces({ organizationId: "org_1" });

      expect(callers).toHaveLength(1);
      expect(callers[0]?.principalArn).toContain("assumed-role/agent/");
      expect(callers[0]?.models.toSorted()).toEqual(["m1", "m2"]);
      expect(callers[0]?.callCount).toBe(2);
    });
  });

  describe("when the organisation has many live projects", () => {
    /** @scenario The trace lookup for callers runs a few projects at a time */
    it("runs at most a few trace lookups at once and asks every project", async () => {
      const events = new MemoryOcsfEventsRepository();
      await events.insertEvents([lakeEvent("e1", UNTRACED, "m1", "eu-west-1")]);
      const projectIds = Array.from({ length: 25 }, (_, i) => `p_${i}`);
      const asked: string[] = [];
      let inFlight = 0;
      let peak = 0;
      const service = SecurityLakeCallersService.create({
        events,
        projects: {
          findInternal: async () => ({ id: GOV }) as never,
          findLiveNonGovernanceIdsByOrganization: async () => projectIds,
        },
        traces: {
          countAttributedTracesByValue: async ({ projectId, values }) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            asked.push(projectId);
            await new Promise((resolve) => setTimeout(resolve, 2));
            inFlight -= 1;
            return values.map((value) => ({ value, count: 0 }));
          },
        },
      });

      const { callers } = await service.withoutTraces({ organizationId: "org_1" });

      expect(callers.map((caller) => caller.principalArn)).toEqual([UNTRACED]);
      expect(asked.toSorted()).toEqual(projectIds.toSorted());
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(TRACE_LOOKUP_CONCURRENCY);
    });

    it("stops asking once every caller is traced", async () => {
      const events = new MemoryOcsfEventsRepository();
      await events.insertEvents([lakeEvent("e1", TRACED, "m1", "eu-west-1")]);
      const asked: string[] = [];
      const service = SecurityLakeCallersService.create({
        events,
        projects: {
          findInternal: async () => ({ id: GOV }) as never,
          findLiveNonGovernanceIdsByOrganization: async () =>
            Array.from({ length: 25 }, (_, i) => `p_${i}`),
        },
        traces: {
          countAttributedTracesByValue: async ({ projectId, values }) => {
            asked.push(projectId);
            return values.map((value) => ({ value, count: 1 }));
          },
        },
      });

      const { callers } = await service.withoutTraces({ organizationId: "org_1" });

      expect(callers).toEqual([]);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.length).toBeLessThanOrEqual(TRACE_LOOKUP_CONCURRENCY);
    });
  });
});
