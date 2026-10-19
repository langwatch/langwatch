/**
 * The writer's guard reads for a test that is not about escalation, the limit or the
 * last administrator: the caller holds everything and the organization has no grants.
 */
import type { AuthzGrantWriterPermissions } from "../../authz-grant-writer.service.ts";

export const permissiveGrantGuards: AuthzGrantWriterPermissions = {
  findPermissionsBeyondCaller: async () => [],
  listManagedBindingsForOrganization: async () => [],
};

export const TEST_CALLER = { type: "user" as const, id: "caller-1" };
