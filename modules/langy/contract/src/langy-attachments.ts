/**
 * Images attached to a Langy message: what Langy accepts, the upload wire, and the file part a
 * sent message carries. Spec: modules/langy/specs/langy-image-attachments.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { LangyAttachmentRefusal } from "./langy.errors.ts";

/** The image types every model Langy runs on reads. */
export const LANGY_ATTACHMENT_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type LangyAttachmentMediaType = (typeof LANGY_ATTACHMENT_MEDIA_TYPES)[number];

/** The largest image one message carries, the stored-object purpose's own limit. */
export const LANGY_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** How many images one message carries. */
export const LANGY_ATTACHMENT_MAX_COUNT = 4;

export function isLangyAttachmentMediaType(value: string): value is LangyAttachmentMediaType {
  return (LANGY_ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(value.toLowerCase());
}

/** Whether a file can be attached, decided before it uploads, or why not. */
export function langyAttachmentVerdictOf({
  mediaType,
  byteLength,
}: {
  mediaType: string;
  byteLength: number;
}): "accepted" | LangyAttachmentRefusal {
  if (!isLangyAttachmentMediaType(mediaType)) return "not_an_image";
  if (byteLength > LANGY_ATTACHMENT_MAX_BYTES) return "too_large";
  return "accepted";
}

const langyAttachmentUploadInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  filename: z.string().trim().min(1).max(255),
  mediaType: z.string().min(1).max(127),
  byteLength: z.number().int().positive(),
});
export interface LangyAttachmentUploadInputSchema extends Named<
  typeof langyAttachmentUploadInputSchemaDefinition
> {}
export const langyAttachmentUploadInputSchema: LangyAttachmentUploadInputSchema =
  langyAttachmentUploadInputSchemaDefinition;
export type LangyAttachmentUploadInput = z.infer<typeof langyAttachmentUploadInputSchema>;

/** Where the browser PUTs the bytes: the signed URL and the headers it must send. */
const langyAttachmentUploadSchemaDefinition = z.object({
  objectId: z.string(),
  uploadUrl: z.string(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()).optional(),
});
export interface LangyAttachmentUploadSchema extends Named<
  typeof langyAttachmentUploadSchemaDefinition
> {}
export const langyAttachmentUploadSchema: LangyAttachmentUploadSchema =
  langyAttachmentUploadSchemaDefinition;
export type LangyAttachmentUpload = z.infer<typeof langyAttachmentUploadSchema>;

const langyAttachmentConfirmInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  objectId: z.string().min(1),
});
export interface LangyAttachmentConfirmInputSchema extends Named<
  typeof langyAttachmentConfirmInputSchemaDefinition
> {}
export const langyAttachmentConfirmInputSchema: LangyAttachmentConfirmInputSchema =
  langyAttachmentConfirmInputSchemaDefinition;
export type LangyAttachmentConfirmInput = z.infer<typeof langyAttachmentConfirmInputSchema>;

/** A confirmed image, ready to ride a message as a file part. */
const langyAttachmentSchemaDefinition = z.object({
  objectId: z.string(),
  url: z.string(),
  filename: z.string(),
  mediaType: z.string(),
  byteLength: z.number().int().nonnegative(),
});
export interface LangyAttachmentSchema extends Named<typeof langyAttachmentSchemaDefinition> {}
export const langyAttachmentSchema: LangyAttachmentSchema = langyAttachmentSchemaDefinition;
export type LangyAttachment = z.infer<typeof langyAttachmentSchema>;

/** The address a confirmed image is read back at, the one every stored file is served from. */
export function langyAttachmentUrlOf({
  projectId,
  objectId,
  filename,
}: {
  projectId: string;
  objectId: string;
  filename: string;
}): string {
  return `/api/files/${encodeURIComponent(projectId)}/${encodeURIComponent(objectId)}/${encodeURIComponent(filename)}`;
}

/** One image a user message names, read from its file part. */
export type LangyAttachmentRef = Readonly<{
  objectId: string;
  filename: string;
  mediaType: string;
}>;

const FILE_URL = /^\/api\/files\/([^/]+)\/([^/]+)\/([^/]+)$/;

/**
 * The images a message's parts name in this project, in order. A file part whose address is
 * another project's, or is not a stored file at all, names nothing.
 */
export function langyAttachmentRefsOf({
  projectId,
  parts,
}: {
  projectId: string;
  parts: readonly unknown[] | undefined;
}): LangyAttachmentRef[] {
  const refs: LangyAttachmentRef[] = [];
  for (const part of parts ?? []) {
    if (typeof part !== "object" || part === null) continue;
    const { type, url, mediaType, filename } = part as Record<string, unknown>;
    if (type !== "file" || typeof url !== "string" || typeof mediaType !== "string") continue;
    const match = FILE_URL.exec(url);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    if (decodeURIComponent(match[1]) !== projectId) continue;
    refs.push({
      objectId: decodeURIComponent(match[2]),
      filename: typeof filename === "string" ? filename : decodeURIComponent(match[3]),
      mediaType,
    });
  }
  return refs;
}
