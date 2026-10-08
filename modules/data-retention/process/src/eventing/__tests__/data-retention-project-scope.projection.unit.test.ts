/**
 * @vitest-environment node
 * Spec: modules/data-retention/specs/data-retention-project-scope.feature
 */
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_ARCHIVED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE,
  PROJECT_MOVED_EVENT_TYPE,
} from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import type { DataRetentionProjectScopeState } from "../../repositories/data-retention-project-scope.repository.ts";
import { MemoryDataRetentionProjectScopeRepository } from "../../repositories/memory/memory.data-retention-project-scope.repository.ts";
import {
  type DataRetentionProjectScopePeerEvent,
  dataRetentionProjectScopePeerFold,
  foldDataRetentionProjectScope,
} from "../data-retention-project-scope.projection.ts";

const KEY = {
  tenantId: "organization-1",
  projectId: "project-1",
  organizationId: "organization-1",
};

function event(
  type: DataRetentionProjectScopePeerEvent["type"],
  occurredAt: number,
  data: Record<string, unknown> = {},
): DataRetentionProjectScopePeerEvent {
  return {
    id: `event-${occurredAt}`,
    aggregateId: KEY.projectId,
    aggregateType: PROJECT_AGGREGATE_TYPE,
    tenantId: KEY.tenantId,
    createdAt: occurredAt,
    occurredAt,
    type,
    version: "2026-10-06",
    data: { ...KEY, occurredAt, ...data },
  } as DataRetentionProjectScopePeerEvent;
}

function fold(events: DataRetentionProjectScopePeerEvent[]): DataRetentionProjectScopeState {
  const declaration = dataRetentionProjectScopePeerFold(
    MemoryDataRetentionProjectScopeRepository.create(),
  );
  return events.reduce(foldDataRetentionProjectScope, declaration.fold.init());
}

describe("retention's fold of project's lifecycle facts", () => {
  describe("when a project is created in a team and later moved", () => {
    /** @scenario "A moved project sits under its new team, and a late older fact is inert" */
    it("keeps the newest team, and a redelivered or late fact changes nothing", () => {
      const created = event(PROJECT_CREATED_EVENT_TYPE, 1, { teamId: "team-1", isPersonal: false });
      const moved = event(PROJECT_MOVED_EVENT_TYPE, 2, {
        fromTeamId: "team-1",
        toTeamId: "team-2",
      });

      const state = fold([created, moved]);
      expect(state).toMatchObject({
        projectId: "project-1",
        organizationId: "organization-1",
        teamId: "team-2",
        archivedAt: null,
        LastEventOccurredAt: 2,
      });
      expect(fold([created, moved, created, moved])).toEqual(state);
    });
  });

  describe("when the created fact predates 2026-10-06 and names no team", () => {
    /** @scenario "A project whose facts name no team yet folds its organization only" */
    it("folds the organization and leaves the team for the department fact to name", () => {
      const created = event(PROJECT_CREATED_EVENT_TYPE, 1);
      expect(fold([created])).toMatchObject({ organizationId: "organization-1", teamId: null });

      const assigned = event(PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE, 2, {
        departmentId: null,
        teamId: "team-1",
        isPersonal: false,
      });
      expect(fold([created, assigned])).toMatchObject({ teamId: "team-1", teamRecordedAt: 2 });
    });
  });

  describe("when the project is archived", () => {
    /** @scenario "An archived project keeps its place, so its stored data still expires" */
    it("records when, and keeps its team and organization", () => {
      const state = fold([
        event(PROJECT_CREATED_EVENT_TYPE, 1, { teamId: "team-1", isPersonal: false }),
        event(PROJECT_ARCHIVED_EVENT_TYPE, 3),
      ]);
      expect(state).toMatchObject({ teamId: "team-1", archivedAt: 3 });
    });
  });
});
