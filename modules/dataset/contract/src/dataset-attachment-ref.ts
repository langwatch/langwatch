/**
 * Reading a dataset cell that holds a file: a stored reference
 * (`/api/files/<projectId>/<objectId>/<name>`), an address on another site, or
 * a data URL. Browser safe. @see specs/datasets/dataset-attachment-cells.feature
 */

import type { StoredObjectReference } from "@langwatch/stored-object-contract";

const REF_PREFIX = "/api/files/";

/** The label a cell falls back to when the value carries no readable name. */
const FALLBACK_DISPLAY_NAME = "file";

export interface DatasetAttachmentRef {
  projectId: string;
  objectId: string;
  /** The file name segment, when the reference carries one. */
  name?: string;
}

/** True for a value that points at a file stored in LangWatch; a `..` anywhere disqualifies it. */
export function isDatasetAttachmentRef(value: string): boolean {
  return value.startsWith(REF_PREFIX) && !value.includes("..");
}

/** Decodes one path segment, keeping it as it is when it is not valid escaping. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The parts of a stored-file reference, or null when the value is not one or names no object. */
export function parseDatasetAttachmentRef(value: string): DatasetAttachmentRef | null {
  if (!isDatasetAttachmentRef(value)) return null;

  const path = value.split(/[?#]/)[0] ?? "";
  const segments = path
    .slice(REF_PREFIX.length)
    .split("/")
    .filter((segment) => segment.length > 0);

  const [projectId, objectId, ...rest] = segments;
  if (!projectId || !objectId) return null;

  const name = rest.length > 0 ? decodeSegment(rest.join("/")) : undefined;
  return name ? { projectId, objectId, name } : { projectId, objectId };
}

/** The value a cell holds for a confirmed stored file (ADR-158 §6). */
export function datasetAttachmentRefOf(
  reference: Pick<StoredObjectReference, "projectId" | "id" | "filename">,
): string {
  return `${REF_PREFIX}${reference.projectId}/${reference.id}/${encodeURIComponent(reference.filename)}`;
}

/** The file endings a stored reference names a picture with; SVG is refused at upload. */
const IMAGE_NAME_PATTERN = /\.(jpe?g|gif|png|webp|bmp|avif|heic|tiff?)$/i;

/**
 * True for a stored-file reference that names a picture. For the result
 * tables, which see only the value and would draw a PDF as a broken image.
 */
export function isImageAttachmentRef(value: string): boolean {
  const ref = parseDatasetAttachmentRef(value.trim());
  if (!ref?.name) return false;
  return IMAGE_NAME_PATTERN.test(ref.name);
}

/** The last part of an address on another site, or its host when it has none. */
function displayNameOfUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return FALLBACK_DISPLAY_NAME;
  }
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  return last ? decodeSegment(last) : url.host;
}

/** The name to show for a cell value: the stored name, the address's last part, or a plain word. */
export function attachmentDisplayName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return FALLBACK_DISPLAY_NAME;

  const ref = parseDatasetAttachmentRef(trimmed);
  if (ref) return ref.name ?? FALLBACK_DISPLAY_NAME;

  if (/^https?:\/\//i.test(trimmed)) return displayNameOfUrl(trimmed);

  return FALLBACK_DISPLAY_NAME;
}
