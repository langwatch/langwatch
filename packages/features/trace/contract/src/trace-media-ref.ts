/**
 * Compact trace-level media references, and the chat roles they carry.
 *
 * The trace summary's computed input/output are flattened human-readable
 * text — media parts (players, images, attachments) only exist at span
 * level. So the IO accumulation ALSO derives a compact list of media
 * references from the winning span IO and stores it in the summary's
 * reserved attributes, giving the trace list and the drawer summary a way to
 * show thumbnails and players without reloading span payloads.
 *
 * The shape lives in the contract rather than beside the fold that writes it
 * because it is a READ MODEL: it rides on `TraceListItem`, which the trace
 * transport publishes to every client. A payload type defined in the
 * application would narrow to its declared constraint the moment the
 * transport moved into a package (see the type-narrowing note on
 * `TraceListItem`).
 *
 * Refs are STRICTLY `/api/files/{projectId}/{id}` references — the shape the
 * extraction pipeline mints. Inline base64 would re-bloat the summary row the
 * extraction just slimmed, and an arbitrary URL here would hand every list
 * viewer's browser to whoever controls span content, so both the collector
 * and the defensive parser reject anything else.
 */

/**
 * Chat roles a media part can be attributed to. Same vocabulary the
 * transcript parser accepts for a message envelope; anything else is treated
 * as "no role", which every consumer reads as "show it wherever it would have
 * shown before roles existed".
 */
export const MEDIA_PART_ROLES = [
  "system",
  "user",
  "assistant",
  "tool",
  "developer",
  "function",
] as const;

export type MediaPartRole = (typeof MEDIA_PART_ROLES)[number];

const MEDIA_PART_ROLE_SET: ReadonlySet<string> = new Set(MEDIA_PART_ROLES);

/** True for a role string the walk is willing to attribute a part to. */
export function isMediaPartRole(value: unknown): value is MediaPartRole {
  return typeof value === "string" && MEDIA_PART_ROLE_SET.has(value);
}

export interface TraceMediaRef {
  kind: "audio" | "image" | "video" | "file";
  url: string;
  filename?: string;
  /** Carried for `file` refs so the attachment chip can pick its icon. */
  mimeType?: string;
  /**
   * Role of the chat message the part was found under. A voice turn puts the
   * caller's recording and the agent's reply in the same span payload, so the
   * summary strips need this to show each side its own media. Absent for parts
   * outside a message envelope and for traces ingested before roles were
   * recorded, which every consumer treats as "belongs wherever it used to".
   */
  role?: MediaPartRole;
}

export const RESERVED_INPUT_MEDIA_REFS = "langwatch.reserved.media_refs.input";
export const RESERVED_OUTPUT_MEDIA_REFS = "langwatch.reserved.media_refs.output";
