import { generate } from "@langwatch/ksuid";

import type { GroupIdentity } from "../app/organization.members.ts";
import { organizationResourceSlug } from "../rules/organization-resource-slug.rules.ts";

/** KSUID resource prefixes: a persisted format, since each id is written into a customer's row. */
const GROUP_KSUID_RESOURCE = "group";
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

/**
 * Unlike a team, a group's id is a KSUID and its slug carries no id tail — the organization
 * service appends its own disambiguating suffix when a base slug is already taken.
 */
export class GroupIdentityService implements GroupIdentity {
  static create(): GroupIdentityService {
    return new GroupIdentityService();
  }

  private constructor() {}

  createGroupId(): string {
    return generate(GROUP_KSUID_RESOURCE).toString();
  }

  createBindingId(): string {
    return generate(ROLE_BINDING_KSUID_RESOURCE).toString();
  }

  slugify(name: string): string {
    return organizationResourceSlug(name);
  }
}
