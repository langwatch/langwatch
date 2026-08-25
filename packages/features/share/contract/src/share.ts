import { z } from "zod";

export const shareResourceTypeSchema = z.enum(["TRACE", "THREAD"]);
export type ShareResourceType = z.infer<typeof shareResourceTypeSchema>;

export const shareVisibilitySchema = z.enum(["PUBLIC", "ORGANIZATION", "PROJECT"]);
export type ShareVisibility = z.infer<typeof shareVisibilitySchema>;

export const shareLinkSchema = z
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
export type ShareLink = z.infer<typeof shareLinkSchema>;

export const shareWithProjectSchema = shareLinkSchema.extend({
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
export type ShareWithProject = z.infer<typeof shareWithProjectSchema>;

export const shareViewerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("anonymous") }).strict(),
  z.object({ type: z.literal("user"), id: z.string().min(1) }).strict(),
]);
export type ShareViewer = z.infer<typeof shareViewerSchema>;

export const shareResourceInputSchema = z
  .object({
    projectId: z.string().min(1),
    resourceType: shareResourceTypeSchema,
    resourceId: z.string().min(1),
  })
  .strict();
export type ShareResourceInput = z.infer<typeof shareResourceInputSchema>;

export const createShareInputSchema = shareResourceInputSchema
  .extend({
    visibility: shareVisibilitySchema.optional(),
    expiresAt: z.date().nullable().optional(),
    maxViews: z.number().int().positive().nullable().optional(),
    userId: z.string().min(1).nullable().optional(),
  })
  .strict();
export type CreateShareInput = z.infer<typeof createShareInputSchema>;

export const resolveShareInputSchema = z
  .object({
    token: z.string().min(1),
    viewer: shareViewerSchema,
    viewerKey: z.string().min(1).optional(),
  })
  .strict();
export type ResolveShareInput = z.infer<typeof resolveShareInputSchema>;

export const revokeShareInputSchema = z
  .object({ id: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export type RevokeShareInput = z.infer<typeof revokeShareInputSchema>;

export const tracePinInputSchema = z
  .object({ projectId: z.string().min(1), traceId: z.string().min(1) })
  .strict();
export type TracePinInput = z.infer<typeof tracePinInputSchema>;

export const sharedPayloadCacheInputSchema = z
  .object({
    token: z.string().min(1),
    protections: z.unknown(),
  })
  .strict();
export type SharedPayloadCacheInput = z.infer<typeof sharedPayloadCacheInputSchema>;
