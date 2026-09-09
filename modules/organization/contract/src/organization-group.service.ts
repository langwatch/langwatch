import type { OrganizationGroupBinding } from "./group.ts";

/** Organization-owned workflows that combine group scope data with peer services. */
export abstract class OrganizationGroupService {
  abstract resolveBindingScopeNames(input: {
    organizationId: string;
    bindings: readonly OrganizationGroupBinding[];
  }): Promise<ReadonlyMap<string, string>>;
}
