// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimCreateUserRequest, ScimUser } from "@langwatch/enterprise-scim-contract";
import type { UserProfile } from "@langwatch/user-contract";

/** Postgres reports a duplicate key as P2002; SCIM answers it with 409, not 500. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/** One user as the SCIM 2.0 core schema describes them. */
export function scimUserOf(user: UserProfile): ScimUser {
  const { givenName, familyName } = splitName(user.name ?? "");

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    userName: user.email ?? "",
    name: {
      givenName,
      familyName,
    },
    emails: [
      {
        primary: true,
        value: user.email ?? "",
        type: "work",
      },
    ],
    active: user.deactivatedAt === null,
    meta: {
      resourceType: "User",
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
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

export function tryParseUserNameFilter(filter?: string): string | null {
  if (!filter) {
    return null;
  }

  const match = filter.match(/^userName\s+eq\s+"([^"]+)"$/);

  return match?.[1] ?? null;
}
