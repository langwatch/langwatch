/**
 * A read hinted under a field of its event names a field that event carries.
 * Spec: packages/api/specs/read-hints.feature.
 */
import {
  PROJECT_CREATED_EVENT_TYPE,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { inviteTrpc } from "../invite.trpc.ts";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  inviteAcceptedEventDataSchema,
  MEMBERS_INVITED_EVENT_TYPE,
  membersInvitedEventDataSchema,
  ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  organizationMemberDepartmentChangedEventDataSchema,
  organizationMemberDisabledEventDataSchema,
  organizationMemberEnabledEventDataSchema,
  organizationMemberRemovedEventDataSchema,
} from "../organization-lifecycle.events.ts";
import { organizationTrpc } from "../organization.trpc.ts";

/** The data schema of every event this contract's reads scope by; a new one is added here. */
const eventData = new Map<string, { shape: Readonly<Record<string, unknown>> }>([
  [PROJECT_CREATED_EVENT_TYPE, projectCreatedEventDataSchema],
  [INVITE_ACCEPTED_EVENT_TYPE, inviteAcceptedEventDataSchema],
  [MEMBERS_INVITED_EVENT_TYPE, membersInvitedEventDataSchema],
  [ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE, organizationMemberDisabledEventDataSchema],
  [ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE, organizationMemberEnabledEventDataSchema],
  [ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE, organizationMemberRemovedEventDataSchema],
  [
    ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE,
    organizationMemberDepartmentChangedEventDataSchema,
  ],
]);

const scoped = [
  ...Object.entries(organizationTrpc.members),
  ...Object.entries(inviteTrpc.members),
].flatMap(([name, member]) =>
  (member.invalidatedBy ?? []).flatMap((invalidation) =>
    typeof invalidation === "string" ? [] : [{ name, ...invalidation }],
  ),
);

describe("organization reads hinted under an event field", () => {
  /** @scenario "Every scope a read names is a field of its event's data" */
  it("name only fields their event's data declares", () => {
    expect(scoped.length).toBeGreaterThan(0);
    for (const { name, event, scope } of scoped) {
      const shape = eventData.get(event)?.shape;

      expect(shape, `${name}: ${event} has no data schema registered in this test`).toBeDefined();
      expect(Object.keys(shape ?? {}), `${name}: ${event}`).toContain(scope);
    }
  });

  /** @scenario "Every scope a read names is a field of its event's data" */
  it("hints the scope graph under the organization of a created project", () => {
    expect(organizationTrpc.members.getScopeGraph.invalidatedBy).toContainEqual({
      event: PROJECT_CREATED_EVENT_TYPE,
      scope: "organizationId",
    });
  });

  /** @scenario "Every scope a read names is a field of its event's data" */
  it("hints every member list when a member is removed from the organization", () => {
    const removal = { event: ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE, scope: "organizationId" };
    const { members } = organizationTrpc;

    expect(members.getOrganizationWithMembersAndTheirTeams.invalidatedBy).toContainEqual(removal);
    expect(members.getAllOrganizationMembers.invalidatedBy).toContainEqual(removal);
    expect(members.getDirectoryCounts.invalidatedBy).toContainEqual(removal);
  });
});
