/**
 * What a dataset attachment may be: how big, and of which media type. Browser
 * safe, so the upload button and the run refuse on the same numbers.
 * @see specs/datasets/dataset-attachments.feature
 */
import {
  DATASET_ATTACHMENT_PURPOSE,
  REFUSED_ATTACHMENT_MEDIA_TYPES,
} from "@langwatch/stored-object-contract";

/** The largest file a dataset cell accepts. Matches the NLP engine's own cap. */
export const DATASET_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/** The media type used when the upload declares none. */
export const DATASET_ATTACHMENT_DEFAULT_MEDIA_TYPE = "application/octet-stream";

/** Headroom over a file cap for the multipart framing, so a file of exactly the cap passes. */
export const DATASET_ATTACHMENT_MULTIPART_SLACK_BYTES = 1024 * 1024;

/** The body cap the deprecated attachment upload route applies to the whole multipart request. */
export const DATASET_ATTACHMENT_REQUEST_MAX_BYTES =
  DATASET_ATTACHMENT_MAX_BYTES + DATASET_ATTACHMENT_MULTIPART_SLACK_BYTES;

/** The declared media type without its parameters, lower-cased, or the default when absent. */
export function normalizeAttachmentMediaType(declared: string | undefined | null): string {
  const base = (declared ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "" ? DATASET_ATTACHMENT_DEFAULT_MEDIA_TYPE : base;
}

/** True for a media type a browser can run, which an upload never accepts. */
export function isRefusedAttachmentMediaType(mediaType: string): boolean {
  return (REFUSED_ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(
    normalizeAttachmentMediaType(mediaType),
  );
}

export type DatasetAttachmentVerdict =
  | { accepted: true }
  | { accepted: false; refusal: "wrong_purpose" | "type_refused" | "too_large" };

/** Whether a confirmed stored file may sit in an image or file cell (ADR-158 §6). */
export function datasetAttachmentAcceptance(input: {
  columnType: "image" | "file";
  purpose: string;
  mediaType: string;
  byteLength: number;
}): DatasetAttachmentVerdict {
  if (input.purpose !== DATASET_ATTACHMENT_PURPOSE)
    return { accepted: false, refusal: "wrong_purpose" };
  const mediaType = normalizeAttachmentMediaType(input.mediaType);
  const imageRefused = input.columnType === "image" && !mediaType.startsWith("image/");
  if (imageRefused || isRefusedAttachmentMediaType(mediaType)) {
    return { accepted: false, refusal: "type_refused" };
  }
  if (input.byteLength > DATASET_ATTACHMENT_MAX_BYTES)
    return { accepted: false, refusal: "too_large" };
  return { accepted: true };
}
