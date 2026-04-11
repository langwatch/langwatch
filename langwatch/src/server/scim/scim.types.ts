import { z } from "zod";

export interface ScimUser {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"];
  id: string;
  userName: string;
  name: {
    givenName: string;
    familyName: string;
  };
  emails: Array<{
    primary: boolean;
    value: string;
    type: string;
  }>;
  active: boolean;
  meta: {
    resourceType: "User";
    created: string;
    lastModified: string;
  };
}

export interface ScimListResponse<T> {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimError {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"];
  status: string;
  detail: string;
}

export const scimPatchOperationSchema = z.object({
  op: z.enum(["replace", "add", "remove"]),
  path: z.string().optional(),
  value: z.unknown().optional(),
});

export type ScimPatchOperation = z.infer<typeof scimPatchOperationSchema>;

export const scimPatchRequestSchema = z.object({
  schemas: z.array(z.string()),
  Operations: z.array(scimPatchOperationSchema),
});

export type ScimPatchRequest = z.infer<typeof scimPatchRequestSchema>;

export const scimCreateUserRequestSchema = z.object({
  schemas: z.array(z.string()),
  userName: z.string().email(),
  name: z
    .object({
      givenName: z.string().optional(),
      familyName: z.string().optional(),
    })
    .optional(),
  emails: z
    .array(
      z.object({
        primary: z.boolean().optional(),
        value: z.string(),
        type: z.string().optional(),
      })
    )
    .optional(),
  active: z.boolean().optional(),
});

export type ScimCreateUserRequest = z.infer<typeof scimCreateUserRequestSchema>;

// SCIM Group types

export interface ScimGroup {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"];
  id: string;
  displayName: string;
  members?: Array<{
    value: string;
    display?: string;
  }>;
  meta: {
    resourceType: "Group";
    created: string;
    lastModified: string;
  };
}

export const scimGroupMemberSchema = z.object({
  value: z.string(),
  display: z.string().optional(),
});

export const scimCreateGroupRequestSchema = z.object({
  schemas: z.array(z.string()),
  displayName: z.string(),
  members: z.array(scimGroupMemberSchema).optional(),
});

export type ScimCreateGroupRequest = z.infer<typeof scimCreateGroupRequestSchema>;

export const scimReplaceGroupRequestSchema = z.object({
  schemas: z.array(z.string()),
  displayName: z.string(),
  members: z.array(scimGroupMemberSchema).optional(),
});

export type ScimReplaceGroupRequest = z.infer<typeof scimReplaceGroupRequestSchema>;

/**
 * Type guard that checks whether a value is a SCIM 2.0 Error response.
 * Shared across all SCIM route handlers.
 */
export function isScimError(value: unknown): value is ScimError {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemas" in value &&
    Array.isArray((value as ScimError).schemas) &&
    (value as ScimError).schemas[0] ===
      "urn:ietf:params:scim:api:messages:2.0:Error"
  );
}
