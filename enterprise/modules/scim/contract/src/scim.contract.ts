// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

export const SCIM_FEATURE_ID = "scim" as const;

export const scimUserSchema = z.object({
  schemas: z.array(z.literal("urn:ietf:params:scim:schemas:core:2.0:User")),
  id: z.string(),
  /** The identity provider's identifier, scoped to its SSO connection. */
  externalId: z.string().optional(),
  userName: z.string(),
  name: z.object({
    givenName: z.string(),
    familyName: z.string(),
  }),
  emails: z.array(
    z.object({
      primary: z.boolean(),
      value: z.string(),
      type: z.string(),
    }),
  ),
  active: z.boolean(),
  meta: z.object({
    resourceType: z.literal("User"),
    created: z.string(),
    lastModified: z.string(),
  }),
});
export type ScimUser = z.infer<typeof scimUserSchema>;

/** One page of resources, in the shape every SCIM collection answers with. */
export function scimListResponseSchema<Item extends z.ZodType>(
  item: Item,
): z.ZodType<ScimListResponse<z.infer<Item>>> {
  return z.object({
    schemas: z.array(z.literal("urn:ietf:params:scim:api:messages:2.0:ListResponse")),
    totalResults: z.number().int(),
    startIndex: z.number().int(),
    itemsPerPage: z.number().int(),
    Resources: z.array(item),
  });
}
export type ScimListResponse<T> = Readonly<{
  schemas: "urn:ietf:params:scim:api:messages:2.0:ListResponse"[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}>;

export const scimErrorSchema = z.object({
  schemas: z.array(z.literal("urn:ietf:params:scim:api:messages:2.0:Error")),
  status: z.string(),
  detail: z.string(),
  /** RFC 7644 §3.12's error type, when the refusal has one. */
  scimType: z.string().optional(),
});
export type ScimError = z.infer<typeof scimErrorSchema>;

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

/**
 * The identity provider's own id for a resource, as it actually arrives.
 * Absent and blank mean the same thing; `.min(1)` refused the whole push over
 * a field RFC 7644 makes optional. A blank id must still never reach a store.
 */
const scimExternalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const scimCreateUserRequestSchema = z
  .object({
    schemas: z.array(z.string()),
    externalId: scimExternalId,
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

export const scimGroupSchema = z.object({
  schemas: z.array(z.literal("urn:ietf:params:scim:schemas:core:2.0:Group")),
  id: z.string(),
  /** The identity provider's identifier, scoped to its SSO connection. */
  externalId: z.string().optional(),
  displayName: z.string(),
  members: z
    .array(
      z.object({
        value: z.string(),
        display: z.string().optional(),
      }),
    )
    .optional(),
  meta: z.object({
    resourceType: z.literal("Group"),
    created: z.string(),
    lastModified: z.string(),
  }),
});
export type ScimGroup = z.infer<typeof scimGroupSchema>;

export const scimGroupMemberSchema = z.object({
  value: z.string(),
  display: z.string().optional(),
});

export const scimCreateGroupRequestSchema = z.object({
  schemas: z.array(z.string()),
  externalId: scimExternalId,
  displayName: z.string(),
  members: z.array(scimGroupMemberSchema).optional(),
});

export type ScimCreateGroupRequest = z.infer<typeof scimCreateGroupRequestSchema>;

export const scimReplaceGroupRequestSchema = z.object({
  schemas: z.array(z.string()),
  externalId: scimExternalId,
  displayName: z.string(),
  members: z.array(scimGroupMemberSchema).optional(),
});

export type ScimReplaceGroupRequest = z.infer<typeof scimReplaceGroupRequestSchema>;

// SCIM discovery documents (RFC 7643 §5-7) — fixed content, published so an
// identity provider can negotiate capabilities before a token exists.

const scimSchemaAttributeSchema: z.ZodType<{
  name: string;
  type: string;
  multiValued: boolean;
  required: boolean;
  mutability: string;
  returned: string;
  caseExact?: boolean;
  uniqueness?: string;
  description?: string;
  subAttributes?: {
    name: string;
    type: string;
    multiValued: boolean;
    required: boolean;
    mutability: string;
    returned: string;
    description?: string;
  }[];
}> = z.object({
  name: z.string(),
  type: z.string(),
  multiValued: z.boolean(),
  required: z.boolean(),
  mutability: z.string(),
  returned: z.string(),
  caseExact: z.boolean().optional(),
  uniqueness: z.string().optional(),
  description: z.string().optional(),
  subAttributes: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        multiValued: z.boolean(),
        required: z.boolean(),
        mutability: z.string(),
        returned: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

export const scimSchemaDefinitionSchema = z.object({
  schemas: z.array(z.literal("urn:ietf:params:scim:schemas:core:2.0:Schema")),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  attributes: z.array(scimSchemaAttributeSchema),
  meta: z.object({ resourceType: z.literal("Schema"), location: z.string() }),
});
export type ScimSchemaDefinition = z.infer<typeof scimSchemaDefinitionSchema>;

export const scimResourceTypeSchema = z.object({
  schemas: z.array(z.literal("urn:ietf:params:scim:schemas:core:2.0:ResourceType")),
  id: z.string(),
  name: z.string(),
  endpoint: z.string(),
  schema: z.string(),
  meta: z.object({ resourceType: z.literal("ResourceType"), location: z.string() }),
});
export type ScimResourceType = z.infer<typeof scimResourceTypeSchema>;

export const scimServiceProviderConfigSchema = z.object({
  schemas: z.array(z.literal("urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig")),
  documentationUri: z.string(),
  patch: z.object({ supported: z.boolean() }),
  bulk: z.object({
    supported: z.boolean(),
    maxOperations: z.number().int(),
    maxPayloadSize: z.number().int(),
  }),
  filter: z.object({ supported: z.boolean(), maxResults: z.number().int() }),
  changePassword: z.object({ supported: z.boolean() }),
  sort: z.object({ supported: z.boolean() }),
  etag: z.object({ supported: z.boolean() }),
  authenticationSchemes: z.array(
    z.object({ type: z.string(), name: z.string(), description: z.string() }),
  ),
});
export type ScimServiceProviderConfig = z.infer<typeof scimServiceProviderConfigSchema>;

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
