/**
 * ADR-177 decision 9 at the door: every route proof a user mints on an aggregate is audited once
 * per five minutes. Ports main's tracesV2.aggregate-audit cases; the row itself is governance's.
 * Spec: specs/governance/aggregate-project.feature
 */
import type { CollectedBinding } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import type { RecordAggregateReadCommandData } from "../../eventing/authz-aggregate-read.events.ts";
import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub.ts";
import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub.ts";
import type { SharedReadRow } from "../../repositories/authz-read.repository.ts";
import { AuthzAggregateReadAuditService } from "../authz-aggregate-read-audit.service.ts";
import { AuthzService } from "../authz.service.ts";

const ORG = "org_acme";
const TEAM = "team_leadership";
const AGGREGATE = "proj_company_view";
const MEMBER = "proj_engineering";
const MINUTE = 60_000;

const adminOf = (projectId: string): CollectedBinding => ({
  roleKey: "admin",
  scopeType: "PROJECT",
  scopeId: projectId,
  viaGroupId: null,
});

const memberRead: SharedReadRow = {
  grantId: "grant_engineering",
  memberProjectId: MEMBER,
  condition: { type: "trace", from: "2026-01-01T00:00:00.000Z" },
  expiresAt: null,
};

function harness() {
  let nowMs = Date.now();
  const sent: RecordAggregateReadCommandData[] = [];
  const aggregateReads = AuthzAggregateReadAuditService.create({ now: () => nowMs });
  aggregateReads.connect({
    send: async (data) => {
      sent.push(data);
    },
  });
  const authz = AuthzService.create({
    isOnEngine: async () => true,
    repository: makeReader({
      findOrganizationMembership: vi.fn().mockResolvedValue({ role: "ADMIN", disabled: false }),
      findUserBindings: vi.fn().mockResolvedValue([adminOf(AGGREGATE), adminOf(MEMBER)]),
      findProjectLineage: vi.fn(async ({ projectId }: { projectId: string }) => ({
        teamId: TEAM,
        organizationId: ORG,
        ...(projectId === AGGREGATE ? { kind: "aggregate" } : {}),
      })),
      findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
      findLiveSharedReads: vi.fn(async ({ readerProjectId }: { readerProjectId: string }) =>
        readerProjectId === AGGREGATE ? [memberRead] : [],
      ),
    }),
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
    cacheEnabled: () => false,
    aggregateReads,
  });

  const read = ({
    projectId,
    route,
    actor = "user_ana",
  }: {
    projectId: string;
    route: string;
    actor?: string;
  }) =>
    authz.authorize({
      principal: { type: "user", id: actor },
      permission: "traces:view",
      scope: { type: "project", id: projectId, teamId: TEAM, organizationId: ORG },
      proof: { actor: { type: "user", id: actor }, purpose: { kind: "route", route } },
    });

  return {
    read,
    sent,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("Feature: every read of an aggregate is audited", () => {
  describe("given an aggregate project with one member holding one trace", () => {
    describe("when ana opens the aggregate's trace list and then that trace within five minutes", () => {
      /** @scenario "Any read of the aggregate writes the admin view audit row" */
      it("writes one row of kind aggregate for ana and the aggregate, naming neither the trace nor the member", async () => {
        const { read, sent, advance } = harness();

        await read({ projectId: AGGREGATE, route: "traces.list" });
        advance(MINUTE);
        await read({ projectId: AGGREGATE, route: "traces.header" });
        await read({ projectId: AGGREGATE, route: "traces.spanTree" });

        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
          actorUserId: "user_ana",
          organizationId: ORG,
          aggregateProjectId: AGGREGATE,
        });
        expect(Object.keys(sent[0] ?? {}).toSorted()).toEqual(
          [
            "actorUserId",
            "aggregateProjectId",
            "occurredAt",
            "organizationId",
            "tenantId",
          ].toSorted(),
        );
        expect(JSON.stringify(sent[0])).not.toContain(MEMBER);
      });
    });

    describe("when ana's first read is a deep link to one trace, with no list rendered", () => {
      it("writes the row from that read alone", async () => {
        const { read, sent } = harness();

        await read({ projectId: AGGREGATE, route: "traces.spanTree" });

        expect(sent.map((row) => row.aggregateProjectId)).toEqual([AGGREGATE]);
      });
    });
  });

  describe("given an aggregate project", () => {
    describe("when ana opens its trace list twice within five minutes, then again ten minutes later", () => {
      /** @scenario "The audit row repeats after the five-minute window" */
      it("writes one row for the two reads and a second for the later one", async () => {
        const { read, sent, advance } = harness();

        await read({ projectId: AGGREGATE, route: "traces.list" });
        advance(MINUTE);
        await read({ projectId: AGGREGATE, route: "traces.list" });
        expect(sent).toHaveLength(1);

        advance(10 * MINUTE);
        await read({ projectId: AGGREGATE, route: "traces.list" });

        expect(sent.map((row) => row.aggregateProjectId)).toEqual([AGGREGATE, AGGREGATE]);
      });
    });
  });

  describe("given ana reads the aggregate and then a member directly", () => {
    describe("when the audit rows are counted", () => {
      it("writes the aggregate row only, and no personal or team row", async () => {
        const { read, sent } = harness();

        await read({ projectId: AGGREGATE, route: "traces.list" });
        await read({ projectId: MEMBER, route: "traces.list" });

        expect(sent.map((row) => row.aggregateProjectId)).toEqual([AGGREGATE]);
      });
    });
  });
});
