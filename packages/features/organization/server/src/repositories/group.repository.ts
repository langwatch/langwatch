import type {
  OrganizationGroup,
  OrganizationGroupMember,
} from "@langwatch/organization-contract";

export type OrganizationGroupWithMemberCount = OrganizationGroup & {
  memberCount: number;
};

export abstract class GroupRepository {
  abstract get(input: {
    groupId: string;
    organizationId: string;
  }): Promise<OrganizationGroup>;
  abstract list(input: { organizationId: string; page: number; limit: number }): Promise<{
    data: OrganizationGroupWithMemberCount[];
    pagination: { page: number; limit: number; total: number };
  }>;
  abstract listForMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationGroupWithMemberCount[]>;
  abstract listMembers(input: {
    groupId: string;
    organizationId: string;
  }): Promise<OrganizationGroupMember[]>;
  abstract listMembersForGroups(input: {
    groupIds: string[];
    organizationId: string;
  }): Promise<Map<string, OrganizationGroupMember[]>>;
  abstract nextAvailableSlug(input: {
    organizationId: string;
    baseSlug: string;
    excludeGroupId?: string;
  }): Promise<string>;
  abstract create(input: {
    groupId: string;
    organizationId: string;
    name: string;
    slug: string;
    memberIds: string[];
  }): Promise<OrganizationGroup>;
  abstract rename(input: {
    groupId: string;
    organizationId: string;
    name: string;
    slug: string;
  }): Promise<OrganizationGroup>;
  abstract delete(input: { groupId: string; organizationId: string }): Promise<void>;
  abstract addMember(input: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void>;
  abstract removeMember(input: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void>;
  abstract applyEdits(input: {
    groupId: string;
    organizationId: string;
    rename?: { name: string; slug: string } | null;
    memberUserIdsToAdd: string[];
    memberUserIdsToRemove: string[];
  }): Promise<void>;
}
