import { randomBytes } from "node:crypto";

import { generate } from "@langwatch/ksuid";

import type { PersonalWorkspaceIdentity } from "../app/organization.members.ts";
import type { PersonalWorkspaceResourceIds } from "../repositories/organization.repository.ts";

/** KSUID resource prefixes: a persisted format, since each id is written into a customer's row. */
const TEAM_KSUID_RESOURCE = "team";
const PROJECT_KSUID_RESOURCE = "project";
const GRANT_KSUID_RESOURCE = "rolebinding";

/** The personal slug's user-id prefix length, random suffix length, and ingestion key length. */
const SLUG_USER_PREFIX_CHARS = 12;
const SLUG_SUFFIX_CHARS = 6;
const PERSONAL_PROJECT_API_KEY_CHARS = 40;

/** Uniform characters from the URL-safe alphabet, the format these values have always had. */
function randomUrlSafe(length: number): string {
  return randomBytes(Math.ceil((length * 3) / 4))
    .toString("base64url")
    .slice(0, length);
}

function personalSlug(slugPrefix: string): string {
  return `personal-${slugPrefix}-${randomUrlSafe(SLUG_SUFFIX_CHARS).toLowerCase()}`;
}

export class PersonalWorkspaceIdentityService implements PersonalWorkspaceIdentity {
  static create(): PersonalWorkspaceIdentityService {
    return new PersonalWorkspaceIdentityService();
  }

  private constructor() {}

  create(input: { userId: string; organizationId: string }): PersonalWorkspaceResourceIds {
    const slugPrefix = input.userId.toLowerCase().slice(0, SLUG_USER_PREFIX_CHARS);

    return {
      teamId: generate(TEAM_KSUID_RESOURCE).toString(),
      teamSlug: personalSlug(slugPrefix),
      projectId: generate(PROJECT_KSUID_RESOURCE).toString(),
      projectSlug: personalSlug(slugPrefix),
      projectApiKey: `pkey_${randomUrlSafe(PERSONAL_PROJECT_API_KEY_CHARS)}`,
      ownerBindingId: generate(GRANT_KSUID_RESOURCE).toString(),
    };
  }
}
