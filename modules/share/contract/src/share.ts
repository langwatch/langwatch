import type { Named } from "@langwatch/module";
import { z } from "zod";

export const SHARE_KSUID_RESOURCE = "share";

export const shareResourceTypeSchema = z.enum(["TRACE", "THREAD"]);
export type ShareResourceType = z.infer<typeof shareResourceTypeSchema>;

export const shareVisibilitySchema = z.enum(["PUBLIC", "ORGANIZATION", "PROJECT"]);
export type ShareVisibility = z.infer<typeof shareVisibilitySchema>;

const shareLinkSchemaDefinition = z
  .object({
    id: z.string().min(1),
    token: z.string().min(1),
    resourceType: shareResourceTypeSchema,
    resourceId: z.string().min(1),
    threadId: z.string().nullable(),
    projectId: z.string().min(1),
    userId: z.string().nullable(),
    visibility: shareVisibilitySchema,
    expiresAt: z.date().nullable(),
    maxViews: z.number().int().nullable(),
    viewCount: z.number().int().nonnegative(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface ShareLinkSchema extends Named<typeof shareLinkSchemaDefinition> {}
export const shareLinkSchema: ShareLinkSchema = shareLinkSchemaDefinition;
export type ShareLink = z.infer<typeof shareLinkSchema>;

const shareWithProjectSchemaDefinition = shareLinkSchema.safeExtend({
  project: z
    .object({
      traceSharingEnabled: z.boolean(),
      team: z
        .object({
          organizationId: z.string().min(1),
          organization: z.object({ traceSharingEnabled: z.boolean() }).strict(),
        })
        .strict(),
    })
    .strict(),
});
export interface ShareWithProjectSchema extends Named<typeof shareWithProjectSchemaDefinition> {}
export const shareWithProjectSchema: ShareWithProjectSchema = shareWithProjectSchemaDefinition;
export type ShareWithProject = z.infer<typeof shareWithProjectSchema>;

const shareViewerSchemaDefinition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("anonymous") }).strict(),
  z.object({ type: z.literal("user"), id: z.string().min(1) }).strict(),
]);
export interface ShareViewerSchema extends Named<typeof shareViewerSchemaDefinition> {}
export const shareViewerSchema: ShareViewerSchema = shareViewerSchemaDefinition;
export type ShareViewer = z.infer<typeof shareViewerSchema>;

const shareResourceInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    resourceType: shareResourceTypeSchema,
    resourceId: z.string().min(1),
  })
  .strict();
export interface ShareResourceInputSchema extends Named<
  typeof shareResourceInputSchemaDefinition
> {}
export const shareResourceInputSchema: ShareResourceInputSchema =
  shareResourceInputSchemaDefinition;
export type ShareResourceInput = z.infer<typeof shareResourceInputSchema>;

const createShareInputSchemaDefinition = shareResourceInputSchema
  .safeExtend({
    visibility: shareVisibilitySchema.optional(),
    expiresAt: z.date().nullable().optional(),
    maxViews: z.number().int().positive().nullable().optional(),
    userId: z.string().min(1).nullable().optional(),
  })
  .strict();
export interface CreateShareInputSchema extends Named<typeof createShareInputSchemaDefinition> {}
export const createShareInputSchema: CreateShareInputSchema = createShareInputSchemaDefinition;
export type CreateShareInput = z.infer<typeof createShareInputSchema>;

const resolveShareInputSchemaDefinition = z
  .object({
    token: z.string().min(1),
    viewer: shareViewerSchema,
    viewerKey: z.string().min(1).optional(),
  })
  .strict();
export interface ResolveShareInputSchema extends Named<typeof resolveShareInputSchemaDefinition> {}
export const resolveShareInputSchema: ResolveShareInputSchema = resolveShareInputSchemaDefinition;
export type ResolveShareInput = z.infer<typeof resolveShareInputSchema>;

const revokeShareInputSchemaDefinition = z
  .object({ id: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export interface RevokeShareInputSchema extends Named<typeof revokeShareInputSchemaDefinition> {}
export const revokeShareInputSchema: RevokeShareInputSchema = revokeShareInputSchemaDefinition;
export type RevokeShareInput = z.infer<typeof revokeShareInputSchema>;

const tracePinInputSchemaDefinition = z
  .object({ projectId: z.string().min(1), traceId: z.string().min(1) })
  .strict();
export interface TracePinInputSchema extends Named<typeof tracePinInputSchemaDefinition> {}
export const tracePinInputSchema: TracePinInputSchema = tracePinInputSchemaDefinition;
export type TracePinInput = z.infer<typeof tracePinInputSchema>;

const shareProjectScopeSchemaDefinition = z.object({ projectId: z.string().min(1) }).strict();
export interface ShareProjectScopeSchema extends Named<typeof shareProjectScopeSchemaDefinition> {}
export const shareProjectScopeSchema: ShareProjectScopeSchema = shareProjectScopeSchemaDefinition;
export type ShareProjectScope = z.infer<typeof shareProjectScopeSchema>;

const sharedPayloadCacheInputSchemaDefinition = z
  .object({
    token: z.string().min(1),
    protections: z.unknown(),
  })
  .strict();
export interface SharedPayloadCacheInputSchema extends Named<
  typeof sharedPayloadCacheInputSchemaDefinition
> {}
export const sharedPayloadCacheInputSchema: SharedPayloadCacheInputSchema =
  sharedPayloadCacheInputSchemaDefinition;
export type SharedPayloadCacheInput = z.infer<typeof sharedPayloadCacheInputSchema>;
