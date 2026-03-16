import type { User } from "@prisma/client";

interface ScimUserResource {
  schemas: string[];
  id: string;
  externalId: string | null;
  userName: string | null;
  name: {
    formatted: string | null;
    givenName: string;
    familyName: string;
  };
  displayName: string | null;
  active: boolean;
  meta: {
    resourceType: string;
    created: Date;
    lastModified: Date;
  };
}

/**
 * Maps a Prisma User to a SCIM 2.0 User resource representation.
 */
export function toScimUser({ user }: { user: User }): ScimUserResource {
  const nameParts = (user.name ?? "").split(" ");
  const givenName = nameParts[0] ?? "";
  const familyName = nameParts.slice(1).join(" ") || "";

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    externalId: user.externalId,
    userName: user.email,
    name: {
      formatted: user.name,
      givenName,
      familyName,
    },
    displayName: user.name,
    active: user.deactivatedAt === null,
    meta: {
      resourceType: "User",
      created: user.createdAt,
      lastModified: user.updatedAt,
    },
  };
}

/**
 * Builds a SCIM error response body.
 */
export function scimError({
  status,
  detail,
}: {
  status: number;
  detail: string;
}) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    detail,
    status,
  };
}

/**
 * Builds a SCIM ListResponse.
 */
export function scimListResponse({
  resources,
  totalResults,
  startIndex,
  itemsPerPage,
}: {
  resources: ScimUserResource[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
}) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults,
    startIndex,
    itemsPerPage,
    Resources: resources,
  };
}
