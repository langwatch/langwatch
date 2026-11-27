/**
 * @vitest-environment node
 * Whether a scope's last change reached stored data, and the fold that keeps the latest of each.
 * @see modules/data-retention/specs/retention-apply-record.feature
 */
import { createTenantId, EventUtils } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  applyRetentionApplyStatusEvent,
  createRetentionApplyStatusProjection,
  type RetentionApplyStatusState,
} from "../../eventing/retention-apply-status.projection.ts";
import {
  RETENTION_APPLIED_EVENT_TYPE,
  RETENTION_EXTENSION_AGGREGATE_TYPE,
  RETENTION_EXTENSION_EVENT_VERSION,
  RETENTION_POLICY_CHANGED_EVENT_TYPE,
  type RetentionAppliedEvent,
  type RetentionPolicyChangedEvent,
} from "../../eventing/retention-extension.events.ts";
import { MemoryRetentionApplyStatusRepository } from "../../repositories/memory/memory.retention-apply-status.repository.ts";
import {
  hasDeferredShortening,
  type ScopeApplyRecord,
  storedApplyStatuses,
} from "../stored-apply-status.rules.ts";

const organizationId = "organization-1";
const organization = { scopeType: "ORGANIZATION" as const, scopeId: organizationId };
const team = { scopeType: "TEAM" as const, scopeId: "team-1" };
const project = { scopeType: "PROJECT" as const, scopeId: "project-1" };
const TEN = Date.UTC(2026, 10, 22, 10);
const ELEVEN = Date.UTC(2026, 10, 22, 11);
const teamOfProject = new Map([["project-1", "team-1"]]);

const changed = (at: number, { shortens = false } = {}): RetentionPolicyChangedEvent =>
  EventUtils.createEvent<RetentionPolicyChangedEvent>({
    aggregateType: RETENTION_EXTENSION_AGGREGATE_TYPE,
    aggregateId: organizationId,
    tenantId: createTenantId(organizationId),
    type: RETENTION_POLICY_CHANGED_EVENT_TYPE,
    version: RETENTION_EXTENSION_EVENT_VERSION,
    data: {
      organizationId,
      changeId: `save:${at}`,
      scope: organization,
      category: "traces",
      retentionDays: 30,
      shortens,
      changedAt: at,
    },
    metadata: {},
    occurredAt: at,
  });

const applied = (at: number, mode: "apply" | "raise" = "apply"): RetentionAppliedEvent =>
  EventUtils.createEvent<RetentionAppliedEvent>({
    aggregateType: RETENTION_EXTENSION_AGGREGATE_TYPE,
    aggregateId: "project-1",
    tenantId: createTenantId("project-1"),
    type: RETENTION_APPLIED_EVENT_TYPE,
    version: RETENTION_EXTENSION_EVENT_VERSION,
    data: {
      organizationId,
      projectId: "project-1",
      extensionId: `apply:${at}`,
      category: "traces",
      retentionDays: 30,
      mode,
      tables: [],
      appliedAt: at,
      scope: organization,
    },
    metadata: {},
    occurredAt: at,
  });

const projection = createRetentionApplyStatusProjection({
  store: MemoryRetentionApplyStatusRepository.create(),
});
const fold = (events: (RetentionPolicyChangedEvent | RetentionAppliedEvent)[]) =>
  events.reduce<RetentionApplyStatusState>(applyRetentionApplyStatusEvent, projection.init());

describe("the apply status fold", () => {
  describe("when a change at 10:00 and an apply at 11:00 arrive in either order", () => {
    /** @scenario "The status keeps the latest change and the latest apply whatever their order" */
    it("holds the change at 10:00 and the apply at 11:00", () => {
      const expected = {
        ...organization,
        organizationId,
        changedAt: TEN,
        appliedAt: ELEVEN,
        raisedAt: null,
        shortenedAt: null,
      };
      expect(fold([changed(TEN), applied(ELEVEN)])).toEqual(expected);
      expect(fold([applied(ELEVEN), changed(TEN)])).toEqual(expected);
      expect(fold([applied(ELEVEN), changed(TEN), applied(TEN)])).toEqual(expected);
    });

    /** @scenario "The status keeps raises apart from exact applies" */
    it("holds a raise apart from exact applies and a lengthening save apart from shorter ones", () => {
      expect(fold([changed(TEN), applied(ELEVEN, "raise")])).toEqual({
        ...organization,
        organizationId,
        changedAt: TEN,
        appliedAt: null,
        raisedAt: ELEVEN,
        shortenedAt: null,
      });
    });

    /** @scenario "Only a save that keeps fewer days blocks a later raise" */
    it("stamps a shorter save and leaves an unchanged or longer one out", () => {
      expect(fold([changed(TEN, { shortens: true }), changed(ELEVEN)]).shortenedAt).toBe(TEN);
      expect(fold([changed(TEN), changed(ELEVEN)]).shortenedAt).toBeNull();
    });

    it("keys both facts to the scope they name", () => {
      expect(projection.key?.(changed(TEN))).toBe(
        `${organizationId}:ORGANIZATION:${organizationId}`,
      );
      expect(projection.key?.(applied(ELEVEN))).toBe(
        `${organizationId}:ORGANIZATION:${organizationId}`,
      );
    });
  });
});

describe("a scope's stored apply status", () => {
  describe("when the scope was changed at 10:00 and applied at 11:00", () => {
    /** @scenario "An apply at or after the last change marks the scope applied" */
    it("reads as applied at 11:00", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [organization],
          records: [{ ...organization, changedAt: TEN, appliedAt: ELEVEN }],
          teamOfProject,
        }),
      ).toEqual([{ ...organization, status: "applied", at: ELEVEN }]);
    });
  });

  describe("when the scope was applied at 10:00 and changed again at 11:00", () => {
    /** @scenario "A change after the last apply marks the scope pending" */
    it("reads as pending since 11:00", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [organization],
          records: [{ ...organization, changedAt: ELEVEN, appliedAt: TEN }],
          teamOfProject,
        }),
      ).toEqual([{ ...organization, status: "pending", at: ELEVEN }]);
    });
  });

  describe("when a lengthening save at 10:00 was raised at 11:00", () => {
    /** @scenario "A raise after a lengthening save marks the scope applied" */
    it("reads as applied at 11:00", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [organization],
          records: [
            {
              ...organization,
              changedAt: TEN,
              appliedAt: null,
              raisedAt: ELEVEN,
              shortenedAt: null,
            },
          ],
          teamOfProject,
        }),
      ).toEqual([{ ...organization, status: "applied", at: ELEVEN }]);
    });

    it("never lets a scope's raise cover the scopes it holds", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [project],
          records: [
            { ...project, changedAt: TEN, appliedAt: null },
            { ...organization, changedAt: null, appliedAt: null, raisedAt: ELEVEN },
          ],
          teamOfProject,
        }),
      ).toEqual([{ ...project, status: "pending", at: TEN }]);
    });
  });

  describe("when a shorter save after the last exact apply was never applied before a raise", () => {
    /** @scenario "A raise after an unapplied shorter save leaves the scope pending" */
    it("reads as pending since the lengthening save", () => {
      const NINE = Date.UTC(2026, 10, 22, 9);
      const NOON = Date.UTC(2026, 10, 22, 12);
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [organization],
          records: [
            {
              ...organization,
              changedAt: ELEVEN,
              appliedAt: NINE,
              raisedAt: NOON,
              shortenedAt: TEN,
            },
          ],
          teamOfProject,
        }),
      ).toEqual([{ ...organization, status: "pending", at: ELEVEN }]);
    });

    it("reads as applied once an exact apply followed the shorter save", () => {
      const NOON = Date.UTC(2026, 10, 22, 12);
      const ONE = Date.UTC(2026, 10, 22, 13);
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [organization],
          records: [
            {
              ...organization,
              changedAt: NOON,
              appliedAt: ELEVEN,
              raisedAt: ONE,
              shortenedAt: TEN,
            },
          ],
          teamOfProject,
        }),
      ).toEqual([{ ...organization, status: "applied", at: ONE }]);
    });
  });

  describe("when the rule was saved at noon but the record of that change was lost", () => {
    /** @scenario "A save whose change was not recorded never reads as applied" */
    it("reads as pending since the save, not applied by the older apply", () => {
      const NOON = Date.UTC(2026, 10, 22, 12);
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [{ ...organization, savedAt: NOON }],
          records: [{ ...organization, changedAt: TEN, appliedAt: ELEVEN }],
          teamOfProject,
        }),
      ).toEqual([{ ...organization, status: "pending", at: NOON }]);
    });
  });

  describe("when a project rule changed at 10:00 and a wider scope applied at 11:00", () => {
    /** @scenario "An apply at a wider scope covers the scopes it holds" */
    it("reads the project as applied by the organization's apply", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [project],
          records: [
            { ...project, changedAt: TEN, appliedAt: null },
            { ...organization, changedAt: null, appliedAt: ELEVEN },
          ],
          teamOfProject,
        }),
      ).toEqual([{ ...project, status: "applied", at: ELEVEN }]);
    });

    it("reads the project as applied by its team's apply", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [project],
          records: [
            { ...project, changedAt: TEN, appliedAt: null },
            { ...team, changedAt: null, appliedAt: ELEVEN },
          ],
          teamOfProject,
        }),
      ).toEqual([{ ...project, status: "applied", at: ELEVEN }]);
    });

    it("never lets a narrower apply cover a wider scope", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [organization],
          records: [
            { ...organization, changedAt: TEN, appliedAt: null },
            { ...project, changedAt: null, appliedAt: ELEVEN },
          ],
          teamOfProject,
        }),
      ).toEqual([{ ...organization, status: "pending", at: TEN }]);
    });
  });

  describe("when the scope has no recorded change", () => {
    it("names no status, once per scope however many rules it holds", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [organization, organization],
          records: [{ ...organization, changedAt: null, appliedAt: ELEVEN }],
          teamOfProject,
        }),
      ).toEqual([]);
    });

    /** @scenario "A rule with no recorded change shows no status" */
    it("names no status when no apply reached the scope either", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [{ ...project, savedAt: TEN }],
          records: [],
          teamOfProject,
        }),
      ).toEqual([]);
    });
  });

  describe("when a rule saved at 10:00 lost its change record and the organization applied at 11:00", () => {
    /** @scenario "An apply after a save whose change was not recorded reads as applied" */
    it("reads as applied at 11:00", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [{ ...project, savedAt: TEN }],
          records: [{ ...organization, changedAt: null, appliedAt: ELEVEN }],
          teamOfProject,
        }),
      ).toEqual([{ ...project, status: "applied", at: ELEVEN }]);
    });

    it("reads as applied at its own raise after the save", () => {
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [{ ...team, savedAt: TEN }],
          records: [{ ...team, changedAt: null, appliedAt: null, raisedAt: ELEVEN }],
          teamOfProject,
        }),
      ).toEqual([{ ...team, status: "applied", at: ELEVEN }]);
    });
  });

  describe("when the organization applied at 09:00 and a rule saved at 10:00 lost its change record", () => {
    /** @scenario "A save whose change was not recorded after the last apply reads as pending" */
    it("reads as pending since 10:00", () => {
      const NINE = Date.UTC(2026, 10, 22, 9);
      expect(
        storedApplyStatuses({
          organizationId,
          scopes: [{ ...team, savedAt: TEN }],
          records: [{ ...organization, changedAt: null, appliedAt: NINE }],
          teamOfProject,
        }),
      ).toEqual([{ ...team, status: "pending", at: TEN }]);
    });
  });
});

describe("a deferred shorter save on a project's chain", () => {
  const records = (...rows: ScopeApplyRecord[]) => rows;
  const deferred = (rows: ScopeApplyRecord[]) =>
    hasDeferredShortening({ organizationId, projectId: "project-1", records: rows, teamOfProject });

  it("holds while no exact apply at its scope or a wider one came after it", () => {
    expect(
      deferred(records({ ...organization, changedAt: TEN, appliedAt: null, shortenedAt: TEN })),
    ).toBe(true);
  });

  it("ends once an exact apply at its scope or a wider one came after it", () => {
    expect(
      deferred(records({ ...organization, changedAt: TEN, appliedAt: ELEVEN, shortenedAt: TEN })),
    ).toBe(false);
    expect(
      deferred(
        records(
          { ...team, changedAt: TEN, appliedAt: null, shortenedAt: TEN },
          { ...organization, changedAt: null, appliedAt: ELEVEN },
        ),
      ),
    ).toBe(false);
  });

  it("holds for a team save when the organization applied before it", () => {
    expect(
      deferred(
        records(
          { ...team, changedAt: ELEVEN, appliedAt: null, shortenedAt: ELEVEN },
          { ...organization, changedAt: null, appliedAt: TEN },
        ),
      ),
    ).toBe(true);
  });

  it("is not lifted by an apply on a narrower scope", () => {
    expect(
      deferred(
        records(
          { ...organization, changedAt: TEN, appliedAt: null, shortenedAt: TEN },
          { ...project, changedAt: null, appliedAt: ELEVEN },
        ),
      ),
    ).toBe(true);
  });

  it("never holds without a shorter save", () => {
    expect(deferred(records({ ...organization, changedAt: TEN, appliedAt: null }))).toBe(false);
  });
});
