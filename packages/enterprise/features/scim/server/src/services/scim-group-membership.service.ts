// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { ScimPatchOperation } from "@langwatch/enterprise-scim-contract";
import type { ScimGroupRecord, ScimRepositoryPort } from "../ports/scim-repository.port";

const logger = createLogger("langwatch:scim:group");

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

/** Owns SCIM Group membership diffs and their conservative PATCH interpretation. */
export class ScimGroupMembershipService {
  private constructor(private readonly repository: ScimRepositoryPort) {}

  static create(repository: ScimRepositoryPort): ScimGroupMembershipService {
    return new ScimGroupMembershipService(repository);
  }

  async uniqueSlug(organizationId: string, name: string): Promise<string> {
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

  async remove(input: { groupId: string; userIds: string[] }): Promise<void> {
    await this.repository.removeGroupMembers(input);
  }

  async replace(input: {
    group: ScimGroupRecord;
    organizationId: string;
    memberIds: string[];
  }): Promise<void> {
    const currentIds = new Set(
      await this.repository.listGroupMemberIds({ groupId: input.group.id }),
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
      await this.remove({ groupId: input.group.id, userIds: toRemove });
    }
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
        await this.remove({ groupId: input.group.id, userIds: memberIds });
      }
      return;
    }

    if (normalizedOp !== "replace") return;

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
    if (operation.path === "members") return this.readMemberList(operation.value);
    if (!operation.path && isRecord(operation.value) && "members" in operation.value) {
      return this.readMemberList(operation.value.members);
    }
    return { kind: "absent" };
  }

  private readMemberList(value: unknown): MemberInstruction {
    if (value === null) return { kind: "list", ids: [] };
    if (!Array.isArray(value)) return { kind: "malformed" };

    const ids = this.memberIds(value);
    if (ids.length !== value.length || ids.some((id) => id.trim() === "")) {
      return { kind: "malformed" };
    }
    return { kind: "list", ids };
  }

  private memberIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((member) => {
      if (!isRecord(member) || typeof member.value !== "string") return [];
      return [member.value];
    });
  }

  private memberIdsFromPath(path: string, value: unknown): string[] {
    const match = path.match(/members\[value\s+eq\s+"([^"]+)"\]/);
    return match?.[1] ? [match[1]] : this.memberIds(value);
  }
}
