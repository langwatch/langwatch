import type { BlobStore, TraceBlobRef } from "./blob-store.service";

/**
 * Resolves offloaded span field values back to their full form for read paths
 * that need them (online/batch evaluations, "open full" trace detail). Replaces
 * each previewed attribute that has a blob ref with the full value fetched from
 * object storage. List/search paths skip this and use the inline preview. ADR-021.
 *
 * Read coalescing: refs for the same span share a single manifest key
 * (`trace-blobs/{projectId}/{traceId}/{spanId}`). Multiple refs for one span
 * result in ONE S3 fetch — subsequent `get` calls receive the cached manifest
 * from the per-resolve-call Map. ADR-021 Concern 3.
 */
export class SpanBlobResolutionService {
  constructor(private readonly blobStore: BlobStore) {}

  /**
   * @param attributes  span attributes carrying bounded previews
   * @param blobRefs    attrKey → ref for the offloaded fields
   */
  async resolve({
    projectId,
    attributes,
    blobRefs,
  }: {
    projectId: string;
    attributes: Record<string, string>;
    blobRefs: Record<string, TraceBlobRef>;
  }): Promise<Record<string, string>> {
    const keys = Object.keys(blobRefs);
    if (keys.length === 0) return attributes;

    // Per-resolve-call manifest cache: a Map keyed by manifest S3 key whose
    // value is the parsed manifest object. Passed to every BlobStore.get call
    // for this span so multiple refs sharing the same manifest key (= all refs
    // for the same span) only trigger one S3 GET. The Map is local to this
    // invocation — never stale across separate reads. ADR-021 Concern 3.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manifestCache = new Map<string, any>();

    const out = { ...attributes };
    const resolved = await Promise.all(
      keys.map(async (attrKey) => {
        const ref = blobRefs[attrKey]!;
        const full = await this.blobStore.get({ projectId, ref, manifestCache });
        return [attrKey, full] as const;
      }),
    );
    for (const [attrKey, full] of resolved) {
      out[attrKey] = full;
    }
    return out;
  }
}
