// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimCreateUserRequest, ScimUser } from "@langwatch/enterprise-scim-contract";
import { toDate } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";

import type { ScimUserResourceRecord } from "../repositories/scim.repository.ts";

/** Postgres reports a duplicate key as P2002; SCIM answers it with 409, not 500. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * One user as the SCIM 2.0 core schema describes them, read through the
 * organization's own directory resource where it has one: the userName, the
 * display name and `active` are the tenant's, and only the account beneath
 * them answers for somebody no directory has claimed.
 */
export function scimUserOf(user: UserProfile, resource?: ScimUserResourceRecord | null): ScimUser {
  const { givenName, familyName } = splitName((resource ? resource.name : user.name) ?? "");
  const userName = resource?.userName ?? user.email ?? "";

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    userName,
    name: {
      givenName,
      familyName,
    },
    emails: [
      {
        primary: true,
        value: userName,
        type: "work",
      },
    ],
    active: resource?.active ?? user.deactivatedAt === null,
    meta: {
      resourceType: "User",
      created: (resource ? toDate(resource.createdAt) : user.createdAt).toISOString(),
      lastModified: (resource ? toDate(resource.updatedAt) : user.updatedAt).toISOString(),
    },
  };
}

export function nameFromScimRequest(request: ScimCreateUserRequest): string {
  if (request.name) {
    const parts = [request.name.givenName, request.name.familyName].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return request.userName.split("@")[0] ?? request.userName;
}

function splitName(fullName: string): {
  givenName: string;
  familyName: string;
} {
  const spaceIndex = fullName.indexOf(" ");
  if (spaceIndex === -1) {
    return { givenName: fullName, familyName: "" };
  }

  return {
    givenName: fullName.substring(0, spaceIndex),
    familyName: fullName.substring(spaceIndex + 1),
  };
}

export function parseUserNameFilter(filter?: string): string | null {
  if (!filter) {
    return null;
  }

  const match = filter.match(/^userName\s+eq\s+"([^"]+)"$/);

  return match?.[1] ?? null;
}
