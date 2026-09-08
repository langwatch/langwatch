/**
 * Reading a dataset cell that holds a file.
 *
 * An image or file cell holds a plain string: a reference to a file stored in
 * this project (`/api/files/<projectId>/<objectId>/<name>`), an address on
 * another site, or a data URL. The editor, the execution layer and the chip
 * that shows the file name all have to tell those apart, so the rules live
 * here. Browser safe: no server imports, no Node APIs.
 */

const REF_PREFIX = "/api/files/";

/** The label a cell falls back to when the value carries no readable name. */
const FALLBACK_DISPLAY_NAME = "file";

export interface DatasetAttachmentRef {
  projectId: string;
  objectId: string;
  /** The file name segment, when the reference carries one. */
  name?: string;
}

/**
 * True for a value that points at a file stored in LangWatch.
 *
 * A `..` anywhere disqualifies the value: the reference is used to build a
 * request path, and a relative step in it would address something other than
 * the object it names.
 */
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

/**
 * The parts of a stored-file reference, or null when the value is not one or
 * does not name both a project and an object.
 */
export function parseDatasetAttachmentRef(
  value: string,
): DatasetAttachmentRef | null {
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

/**
 * The name to show for a cell value: the file name for a stored file, the last
 * part of the address for a link to another site, and a plain word for a value
 * that carries the bytes inline.
 */
export function attachmentDisplayName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return FALLBACK_DISPLAY_NAME;

  const ref = parseDatasetAttachmentRef(trimmed);
  if (ref) return ref.name ?? FALLBACK_DISPLAY_NAME;

  if (/^https?:\/\//i.test(trimmed)) return displayNameOfUrl(trimmed);

  return FALLBACK_DISPLAY_NAME;
}
