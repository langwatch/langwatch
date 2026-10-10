/**
 * The input parsers of the `/api/api-keys` REST family. Written here beside the
 * response shapes in `api-key.rest.ts` so one file states what the door accepts
 * and the other what it answers, and the published document derives both.
 */
import { principalRefSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { API_KEY_PERMISSION_MODES, refineRestrictedPermissions } from "./api-key.permissions.ts";
import {
  apiKeyPermissionFormatSchema,
  apiKeyRoleSchema,
  apiKeyScopeTypeSchema,
} from "./api-key.ts";

const bindingSchema = z.object({
  role: apiKeyRoleSchema.describe(
    "CUSTOM grants exactly the listed permissions and requires permissionMode 'restricted'.",
  ),
  scopeType: apiKeyScopeTypeSchema,
  scopeId: z.string().min(1),
});

/** One binding as a write states it. */
export type ApiKeyRestBinding = z.infer<typeof bindingSchema>;

const permissionsSchema = z
  .array(apiKeyPermissionFormatSchema)
  .describe(
    "Restricted mode only: the exact resource:action permissions the key's CUSTOM bindings grant.",
  );

const permissionModeSchema = z
  .enum(API_KEY_PERMISSION_MODES)
  .describe(
    "'all' and 'readonly' take their meaning from the bindings alone; 'restricted' additionally requires an explicit permissions list.",
  );

/** The key named in the path of every by-id route. */
const apiKeyRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface ApiKeyRestParamsSchema extends Named<typeof apiKeyRestParamsSchemaDefinition> {}
export const apiKeyRestParamsSchema: ApiKeyRestParamsSchema = apiKeyRestParamsSchemaDefinition;

const apiKeyRestCreateSchemaDefinition = z
  .object({
    keyType: z
      .enum(["personal", "service"])
      .default("personal")
      .describe(
        "A personal key acts as the user who created it and needs explicit bindings. A service key is not tied to a user.",
      ),
    name: z.string().min(1).max(100).describe("Human-readable name for this key"),
    description: z.string().max(500).optional(),
    expiresAt: z.coerce
      .date()
      .optional()
      .describe("ISO 8601 timestamp after which the key stops working"),
    assignedToUserId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Organization admins only: the member who owns the key and whose access caps it. Defaults to the caller.",
      ),
    permissionMode: permissionModeSchema.default("all"),
    permissions: permissionsSchema.optional(),
    bindings: z
      .array(bindingSchema)
      .max(20)
      .optional()
      .describe("What this key may do, and where. Required for a personal key."),
    projectIds: z
      .array(z.string().min(1))
      .max(50)
      .optional()
      .describe("Service keys only: restricts the key to these projects"),
  })
  .refine((data) => data.keyType === "service" || (data.bindings && data.bindings.length > 0), {
    message: "bindings are required for personal keys",
    path: ["bindings"],
  })
  .refine(
    (data) => data.keyType === "service" || !data.projectIds || data.projectIds.length === 0,
    {
      message: "projectIds is only supported for service keys; use bindings instead",
      path: ["projectIds"],
    },
  )
  .superRefine(refineRestrictedPermissions);
export interface ApiKeyRestCreateSchema extends Named<typeof apiKeyRestCreateSchemaDefinition> {}
export const apiKeyRestCreateSchema: ApiKeyRestCreateSchema = apiKeyRestCreateSchemaDefinition;
export type ApiKeyRestCreate = z.infer<typeof apiKeyRestCreateSchema>;

/** A person's own ingestion key on their session's project; `principal` is who the session is. */
const createIngestionKeyInputSchemaDefinition = z.object({
  key: apiKeyRestCreateSchema,
  principal: principalRefSchema.nullable(),
  organizationId: z.string(),
  projectId: z.string(),
});
export interface CreateIngestionKeyInputSchema extends Named<
  typeof createIngestionKeyInputSchemaDefinition
> {}
export const createIngestionKeyInputSchema: CreateIngestionKeyInputSchema =
  createIngestionKeyInputSchemaDefinition;
export type CreateIngestionKeyInput = z.infer<typeof createIngestionKeyInputSchema>;

const apiKeyRestUpdateSchemaDefinition = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullish(),
    permissionMode: permissionModeSchema.optional(),
    permissions: permissionsSchema.optional(),
    bindings: z
      .array(bindingSchema)
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Replaces the key's bindings outright. Whatever is accepted here is exactly what a subsequent GET returns.",
      ),
  })
  .superRefine(refineRestrictedPermissions);
export interface ApiKeyRestUpdateSchema extends Named<typeof apiKeyRestUpdateSchemaDefinition> {}
export const apiKeyRestUpdateSchema: ApiKeyRestUpdateSchema = apiKeyRestUpdateSchemaDefinition;

/** `GET /api/projects`, served here at project's path: the page asked for. */
const projectRestPaginationQuerySchemaDefinition = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});
export interface ProjectRestPaginationQuerySchema extends Named<
  typeof projectRestPaginationQuerySchemaDefinition
> {}
export const projectRestPaginationQuerySchema: ProjectRestPaginationQuerySchema =
  projectRestPaginationQuerySchemaDefinition;

const projectRestCreateSchemaDefinition = z
  .object({
    name: z.string().min(1, "name is required").max(255).describe("Project name"),
    teamId: z.string().min(1).optional().describe("Id of an existing team to put the project in"),
    newTeamName: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("Create a team with this name and put the project in it"),
    language: z
      .string()
      .min(1, "language is required")
      .describe("Programming language, such as python or typescript"),
    framework: z
      .string()
      .min(1, "framework is required")
      .describe("Framework in use, such as langchain or openai"),
  })
  .refine((data) => data.teamId || data.newTeamName, {
    message: "Either teamId or newTeamName must be provided",
  });
export interface ProjectRestCreateSchema extends Named<typeof projectRestCreateSchemaDefinition> {}
export const projectRestCreateSchema: ProjectRestCreateSchema = projectRestCreateSchemaDefinition;

/** `POST /api/organizations`, served by api-key at organization's path (R3, R10). */
const organizationsProvisioningRestCreateSchemaDefinition = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase letters, numbers and single hyphens")
    .optional(),
  adminApiKeyName: z.string().trim().min(1).max(100).optional(),
});
export interface OrganizationsProvisioningRestCreateSchema extends Named<
  typeof organizationsProvisioningRestCreateSchemaDefinition
> {}
export const organizationsProvisioningRestCreateSchema: OrganizationsProvisioningRestCreateSchema =
  organizationsProvisioningRestCreateSchemaDefinition;

const organizationsProvisioningRestCreatedSchemaDefinition = z.object({
  organization: z.object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string(),
  }),
  team: z.object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string(),
  }),
  adminApiKey: z.object({ id: z.string().min(1), token: z.string().min(1) }),
});
export interface OrganizationsProvisioningRestCreatedSchema extends Named<
  typeof organizationsProvisioningRestCreatedSchemaDefinition
> {}
export const organizationsProvisioningRestCreatedSchema: OrganizationsProvisioningRestCreatedSchema =
  organizationsProvisioningRestCreatedSchemaDefinition;

export type OrganizationProvisioningRequest = z.infer<
  typeof organizationsProvisioningRestCreateSchema
>;
export type ProvisionedOrganization = z.infer<typeof organizationsProvisioningRestCreatedSchema>;
