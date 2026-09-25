import { z } from "zod";

/**
 * The byte door's own params — looser than `storedObjectIdentitySchema` (`ids.ts`)
 * on purpose: tightening to the regex-validated id schemas would 400 URLs the door
 * already answers.
 */
export const storedObjectFileRouteScopedParamsSchema = z.object({
  projectId: z.string(),
  storedObjectId: z.string(),
});
export type StoredObjectFileRouteScopedParams = z.infer<
  typeof storedObjectFileRouteScopedParamsSchema
>;

/** The named address a dataset attachment reference carries: the scoped one plus the file name. */
export const storedObjectFileRouteNamedParamsSchema = z.object({
  ...storedObjectFileRouteScopedParamsSchema.shape,
  filename: z.string(),
});
export type StoredObjectFileRouteNamedParams = z.infer<
  typeof storedObjectFileRouteNamedParamsSchema
>;

export const storedObjectFileRouteIdParamsSchema = z.object({ storedObjectId: z.string() });
export type StoredObjectFileRouteIdParams = z.infer<typeof storedObjectFileRouteIdParamsSchema>;

/**
 * The `Content-Disposition` filename a caller may ask for. Optional, so a request
 * naming none answers the object's own id rather than a refusal — and unvalidated
 * beyond "a string", unlike `storedObjectFilenameSchema`'s upload-side rules.
 */
export const storedObjectFileRouteFilenameQuerySchema = z.object({
  filename: z.string().optional(),
});
export type StoredObjectFileRouteFilenameQuery = z.infer<
  typeof storedObjectFileRouteFilenameQuerySchema
>;
