// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/**
 * RFC 7643 §3.1 splits the two identifiers a resource has, and the split is
 * load-bearing for D08:
 *
 *   `id`          OURS. The service provider's identifier, which we mint and
 *                 the identity provider stores. Every `/Users/:id` and
 *                 `/Groups/:id` resolves against this.
 *   `externalId`  THEIRS. The identity provider's own identifier, which is
 *                 what survives a person's email changing. Scoped per
 *                 connection (`ScimExternalId`), never global.
 *
 * A push resolves a person by `externalId` first and their address second;
 * the resource `id` is what the provider quotes back on a later request.
 */
export interface ScimUser {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"];
  id: string;
  /** The identity provider's own identifier, echoed back when we hold one. */
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

/**
 * The identity provider's own id for a resource, as it actually arrives.
 *
 * ABSENT AND BLANK ARE THE SAME THING, and only one of them was accepted.
 * `externalId` is optional in RFC 7644, and a provisioning client that has no
 * external id for somebody sends the key with an empty string about as often
 * as it omits it - the simulator did, and so do real ones. Refusing on
 * `.min(1)` turned that into a 400 for the WHOLE user, over a field nothing
 * required, with a Zod sentence for a detail.
 *
 * So an empty string is read as "none" here rather than argued with, and
 * `.min(1)` still stands for anything that is actually present: what must
 * never reach the store is a blank id pretending to be one.
 */
const scimExternalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const scimCreateUserRequestSchema = z
  .object({
    schemas: z.array(z.string()),
    /** Declared, not cast. It used to be read off the parsed body through a
     *  `as { externalId?: string }` the schema knew nothing about, so nothing
     *  validated it and nothing said it existed. */
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

export interface ScimGroup {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"];
  /** OURS — the service provider's id, which `/Groups/:id` resolves. */
  id: string;
  /** THEIRS — the directory's own identifier, echoed when we hold one. */
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
  /** Declared, not cast — see the note on the user schema above. */
  externalId: scimExternalId,
  displayName: z.string(),
  members: z.array(scimGroupMemberSchema).optional(),
});

export type ScimCreateGroupRequest = z.infer<
  typeof scimCreateGroupRequestSchema
>;

export const scimReplaceGroupRequestSchema = z.object({
  schemas: z.array(z.string()),
  /** A PUT restates the whole resource, so it restates this too. It used to
   *  be accepted on create only, which meant a directory that started sending
   *  it later could never attach it. */
  externalId: scimExternalId,
  displayName: z.string(),
  members: z.array(scimGroupMemberSchema).optional(),
});

export type ScimReplaceGroupRequest = z.infer<
  typeof scimReplaceGroupRequestSchema
>;

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
