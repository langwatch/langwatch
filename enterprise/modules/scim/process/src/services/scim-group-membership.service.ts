// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { ScimPatchOperation } from "@langwatch/enterprise-scim-contract";
import { createLogger } from "@langwatch/observability";

import type { ScimGroupRecord, ScimRepository } from "../repositories/scim.repository.ts";
import type { ScimGrantsService } from "./scim-grants.service.ts";

const logger = createLogger("langwatch:scim:group");

/** The one directory principal, whichever connection pushed the change. */
const SCIM_ACTOR = { type: "system", id: SYSTEM_ACTORS.scim } as const;

type MemberInstruction =
  | { kind: "list"; ids: string[] }
  | { kind: "malformed" }
  | { kind: "absent" };

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The five writes and reads a membership diff makes. */
export type ScimGroupMembershipRepository = Pick<
  ScimRepository,
  "addGroupMember" | "groupSlugExists" | "findGroupMemberIds" | "removeGroupMembers" | "renameGroup"
>;

/** Owns SCIM Group membership diffs and their conservative PATCH interpretation. */
export class ScimGroupMembershipService {
  private constructor(
    private readonly repository: ScimGroupMembershipRepository,
    private readonly grants: ScimGrantsService,
    /** `SCIM_V2_GRANTS`: with it off, membership is still the directory's own
     *  organization-scoped grant, so there is no duplicate to retire. */
    private readonly provenOffboarding: boolean,
  ) {}

  static create(options: {
    repository: ScimGroupMembershipRepository;
    grants: ScimGrantsService;
    provenOffboarding: boolean;
  }): ScimGroupMembershipService {
    return new ScimGroupMembershipService(
      options.repository,
      options.grants,
      options.provenOffboarding,
    );
  }

  async uniqueSlug({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<string> {
    const base = slugify(name) || "group";
    let slug = base;
    let sequence = 1;
    while (await this.repository.groupSlugExists({ organizationId, slug })) {
      slug = `${base}-${sequence++}`;
    }

    return slug;
  }

  async add(input: {
    groupId: string;
    organizationId: string;
    memberIds: string[];
  }): Promise<void> {
    for (const userId of input.memberIds) {
      await this.repository.addGroupMember({
        groupId: input.groupId,
        organizationId: input.organizationId,
        userId,
      });
    }
  }

  /**
   * Access goes before the membership does: whoever leaves a group keeps
   * nothing the directory once gave them at the organization on the way out.
   */
  async remove(input: {
    groupId: string;
    organizationId: string;
    userIds: string[];
  }): Promise<void> {
    if (this.provenOffboarding) {
      await this.grants.retireMembershipGrants({
        organizationId: input.organizationId,
        userIds: input.userIds,
        actor: SCIM_ACTOR,
      });
    }

    await this.repository.removeGroupMembers({
      groupId: input.groupId,
      userIds: input.userIds,
    });
  }

  async replace(input: {
    group: ScimGroupRecord;
    organizationId: string;
    memberIds: string[];
  }): Promise<void> {
    const currentIds = new Set(
      await this.repository.findGroupMemberIds({ groupId: input.group.id }),
    );
    const requestedIds = new Set(input.memberIds);
    const toAdd = [...requestedIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !requestedIds.has(id));

    if (toAdd.length > 0) {
      await this.add({
        groupId: input.group.id,
        organizationId: input.organizationId,
        memberIds: toAdd,
      });
    }

    if (toRemove.length > 0) {
      await this.remove({
        groupId: input.group.id,
        organizationId: input.organizationId,
        userIds: toRemove,
      });
    }
  }

  /**
   * Everyone a patch would write to: the members its operations name, plus the
   * group's current members when one of them replaces the whole list — a
   * replacement removes whoever it leaves out, which is a write against them.
   */
  async membersTouchedByPatch(input: {
    groupId: string;
    operations: readonly ScimPatchOperation[];
  }): Promise<string[]> {
    const touched = new Set<string>();
    let replacesMembers = false;

    for (const operation of input.operations) {
      const named = this.membersNamedBy(operation);
      for (const id of named.ids) touched.add(id);
      replacesMembers ||= named.replacesMembers;
    }

    if (replacesMembers) {
      for (const id of await this.repository.findGroupMemberIds({ groupId: input.groupId })) {
        touched.add(id);
      }
    }

    return [...touched];
  }

  async applyPatch(input: {
    group: ScimGroupRecord;
    organizationId: string;
    operation: ScimPatchOperation;
  }): Promise<void> {
    const operation = input.operation;
    const normalizedOp = operation.op.toLowerCase();
    if (normalizedOp === "add" && operation.path === "members") {
      const memberIds = this.memberIds(operation.value);
      if (memberIds.length > 0) {
        await this.add({
          groupId: input.group.id,
          organizationId: input.organizationId,
          memberIds,
        });
      }

      return;
    }

    if (normalizedOp === "remove" && operation.path?.startsWith("members")) {
      const memberIds = this.memberIdsFromPath(operation.path, operation.value);
      if (memberIds.length > 0) {
        await this.remove({
          groupId: input.group.id,
          organizationId: input.organizationId,
          userIds: memberIds,
        });
      }

      return;
    }

    if (normalizedOp !== "replace") {
      return;
    }

    const renamed = await this.renameIfRequested(input.group.id, operation);
    const instruction = this.requestedMemberIds(operation);
    if (instruction.kind !== "list") {
      if (instruction.kind === "malformed") {
        logger.warn(
          { groupId: input.group.id, path: operation.path },
          "SCIM group replace named members but did not give a list; membership left unchanged",
        );
      } else if (!renamed) {
        logger.warn(
          { groupId: input.group.id, path: operation.path },
          "SCIM group replace matched no known attribute; leaving the group unchanged",
        );
      }

      return;
    }

    await this.replace({
      group: input.group,
      organizationId: input.organizationId,
      memberIds: instruction.ids,
    });
  }

  /** Who one operation writes to, and whether it restates the whole list. */
  private membersNamedBy(operation: ScimPatchOperation): {
    ids: string[];
    replacesMembers: boolean;
  } {
    const normalizedOp = operation.op.toLowerCase();
    if (normalizedOp === "add" && operation.path === "members") {
      return { ids: this.memberIds(operation.value), replacesMembers: false };
    }

    if (normalizedOp === "remove" && operation.path?.startsWith("members")) {
      return {
        ids: this.memberIdsFromPath(operation.path, operation.value),
        replacesMembers: false,
      };
    }

    if (normalizedOp !== "replace") return { ids: [], replacesMembers: false };

    const instruction = this.requestedMemberIds(operation);

    return instruction.kind === "list"
      ? { ids: instruction.ids, replacesMembers: true }
      : { ids: [], replacesMembers: false };
  }

  private async renameIfRequested(
    groupId: string,
    operation: ScimPatchOperation,
  ): Promise<boolean> {
    if (operation.path === "displayName" && typeof operation.value === "string") {
      await this.repository.renameGroup({ id: groupId, name: operation.value });

      return true;
    }

    if (!operation.path && isRecord(operation.value)) {
      const displayName = operation.value.displayName;
      if (typeof displayName === "string") {
        await this.repository.renameGroup({ id: groupId, name: displayName });

        return true;
      }
    }

    return false;
  }

  private requestedMemberIds(operation: ScimPatchOperation): MemberInstruction {
    if (operation.path === "members") {
      return this.readMemberList(operation.value);
    }

    if (!operation.path && isRecord(operation.value) && "members" in operation.value) {
      return this.readMemberList(operation.value.members);
    }

    return { kind: "absent" };
  }

  private readMemberList(value: unknown): MemberInstruction {
    if (value === null) {
      return { kind: "list", ids: [] };
    }

    if (!Array.isArray(value)) {
      return { kind: "malformed" };
    }

    const ids = this.memberIds(value);
    if (ids.length !== value.length || ids.some((id) => id.trim() === "")) {
      return { kind: "malformed" };
    }

    return { kind: "list", ids };
  }

  private memberIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((member) => {
      if (!isRecord(member) || typeof member.value !== "string") {
        return [];
      }

      return [member.value];
    });
  }

  private memberIdsFromPath(path: string, value: unknown): string[] {
    const match = path.match(/members\[value\s+eq\s+"([^"]+)"\]/);

    return match?.[1] ? [match[1]] : this.memberIds(value);
  }
}
