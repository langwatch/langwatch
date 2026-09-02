/**
 * Where media lifted out of a span's content is put.
 *
 * One method, because that is the whole of what the extraction path asks of
 * the object store: hand it bytes and a purpose, get back the id the span
 * attribute is rewritten to point at. The store itself is
 * `@langwatch/stored-object-server`'s content-addressed `StoredObjectsService`,
 * which satisfies this — a feature server package may not reach into another
 * feature's server package, so the process joins the two.
 *
 * `isDuplicate` matters to the caller rather than being incidental: the same
 * image posted on two spans is stored once, and the extraction hook's counters
 * report a re-reference rather than a second write.
 */
export abstract class TraceMediaStorePort {
  abstract storeFromBytes(input: {
    projectId: string;
    purpose: string;
    ownerKind: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<{ id: string; mediaType: string; isDuplicate: boolean }>;
}

/**
 * The fail-open reasons the edge extraction reports, under the names the
 * `edge_media_extract_fail_open` counter already carries.
 *
 * The first three are the hook itself standing down — a flag store it could
 * not read, a privacy probe that failed, a store that refused — and the last
 * three are budget outcomes rather than errors: parts left inline because the
 * per-span cap or the extraction deadline was hit, or because one part's store
 * failed while the rest of the span proceeded.
 */
export type TraceEdgeMediaFailOpenReason =
  | "flag_store"
  | "privacy_probe"
  | "storage"
  | "part_cap"
  | "deadline"
  | "part_store";

/** The one series the edge extraction reports. Absent means unreported. */
export abstract class TraceEdgeMediaTelemetryPort {
  abstract failOpen(reason: TraceEdgeMediaFailOpenReason, count?: number): void;
}
