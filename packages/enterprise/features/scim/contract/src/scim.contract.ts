// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

export const SCIM_FEATURE_ID = "scim" as const;

export interface ScimUser {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"];
  id: string;
  /** The identity provider's identifier, scoped to its SSO connection. */
  externalId?: string;
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

/**
 * RFC 7644 §3.5.2 spells the operation values in lowercase, but Microsoft
 * Entra sends them capitalized — `"Replace"`, `"Add"`, `"Remove"` — the way
 * Microsoft's own SCIM provisioning tutorial documents them. Normalising here
 * keeps every `operation.op === "replace"` comparison downstream working
 * against one spelling instead of spreading the tolerance across the services.
 *
 * Only strings are lowercased: a missing or non-string `op` falls through to
 * the enum so it still fails as a bad value rather than as the string
 * `"undefined"`.
 */
const scimPatchOpSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() : value),
  z.enum(["replace", "add", "remove"]),
);

export const scimPatchOperationSchema = z.object({
  op: scimPatchOpSchema,
  path: z.string().optional(),
  value: z.unknown().optional(),
});

export type ScimPatchOperation = z.infer<typeof scimPatchOperationSchema>;

export const scimPatchRequestSchema = z.object({
  schemas: z.array(z.string()),
  Operations: z.array(scimPatchOperationSchema),
});

export type ScimPatchRequest = z.infer<typeof scimPatchRequestSchema>;

/**
 * SCIM 2.0 Enterprise User extension (RFC 7643 §4.3). The IdP carries
 * org-chart attributes here; we read `costCenter` to drive department
 * assignment, mirroring how it drives department/division elsewhere.
 */
export const SCIM_ENTERPRISE_USER_SCHEMA =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

const scimEnterpriseUserSchema = z
  .object({
    costCenter: z.string().nullish(),
  })
  .passthrough();

export const scimCreateUserRequestSchema = z
  .object({
    schemas: z.array(z.string()),
    externalId: z.string().min(1).optional(),
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
        }),
      )
      .optional(),
    active: z.boolean().optional(),
    [SCIM_ENTERPRISE_USER_SCHEMA]: scimEnterpriseUserSchema.optional(),
  })
  .passthrough();

export type ScimCreateUserRequest = z.infer<typeof scimCreateUserRequestSchema>;

// SCIM Group types

export interface ScimGroup {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"];
  id: string;
  /** The identity provider's identifier, scoped to its SSO connection. */
  externalId?: string;
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
  externalId: z.string().min(1).optional(),
  displayName: z.string(),
  members: z.array(scimGroupMemberSchema).optional(),
});

export type ScimCreateGroupRequest = z.infer<typeof scimCreateGroupRequestSchema>;

export const scimReplaceGroupRequestSchema = z.object({
  schemas: z.array(z.string()),
  externalId: z.string().min(1).optional(),
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
    (value as ScimError).schemas[0] === "urn:ietf:params:scim:api:messages:2.0:Error"
  );
}
