import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * The byte door's own params — looser than `storedObjectIdentitySchema` (`ids.ts`)
 * on purpose: tightening to the regex-validated id schemas would 400 URLs the door
 * already answers.
 */
const storedObjectFileRouteScopedParamsSchemaDefinition = z.object({
  projectId: z.string(),
  storedObjectId: z.string(),
});
export interface StoredObjectFileRouteScopedParamsSchema extends Named<
  typeof storedObjectFileRouteScopedParamsSchemaDefinition
> {}
export const storedObjectFileRouteScopedParamsSchema: StoredObjectFileRouteScopedParamsSchema =
  storedObjectFileRouteScopedParamsSchemaDefinition;
export type StoredObjectFileRouteScopedParams = z.infer<
  typeof storedObjectFileRouteScopedParamsSchema
>;

/** The named address a dataset attachment reference carries: the scoped one plus the file name. */
const storedObjectFileRouteNamedParamsSchemaDefinition = z.object({
  ...storedObjectFileRouteScopedParamsSchema.shape,
  filename: z.string(),
});
export interface StoredObjectFileRouteNamedParamsSchema extends Named<
  typeof storedObjectFileRouteNamedParamsSchemaDefinition
> {}
export const storedObjectFileRouteNamedParamsSchema: StoredObjectFileRouteNamedParamsSchema =
  storedObjectFileRouteNamedParamsSchemaDefinition;
export type StoredObjectFileRouteNamedParams = z.infer<
  typeof storedObjectFileRouteNamedParamsSchema
>;

const storedObjectFileRouteIdParamsSchemaDefinition = z.object({ storedObjectId: z.string() });
export interface StoredObjectFileRouteIdParamsSchema extends Named<
  typeof storedObjectFileRouteIdParamsSchemaDefinition
> {}
export const storedObjectFileRouteIdParamsSchema: StoredObjectFileRouteIdParamsSchema =
  storedObjectFileRouteIdParamsSchemaDefinition;
export type StoredObjectFileRouteIdParams = z.infer<typeof storedObjectFileRouteIdParamsSchema>;

/**
 * The `Content-Disposition` filename a caller may ask for. Optional, so a request
 * naming none answers the object's own id rather than a refusal — and unvalidated
 * beyond "a string", unlike `storedObjectFilenameSchema`'s upload-side rules.
 */
const storedObjectFileRouteFilenameQuerySchemaDefinition = z.object({
  filename: z.string().optional(),
});
export interface StoredObjectFileRouteFilenameQuerySchema extends Named<
  typeof storedObjectFileRouteFilenameQuerySchemaDefinition
> {}
export const storedObjectFileRouteFilenameQuerySchema: StoredObjectFileRouteFilenameQuerySchema =
  storedObjectFileRouteFilenameQuerySchemaDefinition;
export type StoredObjectFileRouteFilenameQuery = z.infer<
  typeof storedObjectFileRouteFilenameQuerySchema
>;

const STORED_OBJECT_FILES_PREFIX = "/api/files/";

/** One stored object as a persisted reference names it; no `projectId` on legacy id-only ones. */
export type StoredObjectFileReference = Readonly<{
  projectId: string | undefined;
  storedObjectId: string;
  filename: string | undefined;
}>;

/**
 * The reference string a feature persists for an object: an opaque address readers exchange for a
 * short-lived signed URL, never a delivery URL itself (ADR-002).
 */
export function storedObjectFileReferenceOf({
  projectId,
  storedObjectId,
}: {
  projectId: string;
  storedObjectId: string;
}): string {
  return `${STORED_OBJECT_FILES_PREFIX}${projectId}/${storedObjectId}`;
}

/** Reads `/api/files/:projectId/:id[/:name]` or the legacy `/api/files/:id`; else undefined. */
export function parseStoredObjectFileReference(
  reference: string,
): StoredObjectFileReference | undefined {
  if (!reference.startsWith(STORED_OBJECT_FILES_PREFIX)) return undefined;
  const [path = "", query = ""] = reference.slice(STORED_OBJECT_FILES_PREFIX.length).split(/[?#]/);
  const [first, second, third] = path.split("/");
  if (!first) return undefined;
  const named =
    third ??
    query
      .split("&")
      .find((pair) => pair.startsWith("filename="))
      ?.slice("filename=".length);
  let filename: string | undefined;
  try {
    filename = named ? decodeURIComponent(named) : undefined;
  } catch {
    // A malformed escape such as `%ZZ` names no file rather than throwing a `URIError`.
  }

  return second
    ? { projectId: first, storedObjectId: second, filename }
    : { projectId: undefined, storedObjectId: first, filename };
}

/** `GET /api/image-proxy?url=` - an absent `url` is main's 400, not a validation refusal. */
const imageProxyQuerySchemaDefinition = z.object({ url: z.string().optional() });
export interface ImageProxyQuerySchema extends Named<typeof imageProxyQuerySchemaDefinition> {}
export const imageProxyQuerySchema: ImageProxyQuerySchema = imageProxyQuerySchemaDefinition;

export type ImageProxyRequest = z.infer<typeof imageProxyQuerySchema>;
