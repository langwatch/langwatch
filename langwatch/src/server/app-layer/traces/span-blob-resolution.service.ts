import type { BlobStore, TraceBlobRef } from "./blob-store.service";

/**
 * Resolves offloaded span field values back to their full form for read paths
 * that need them (online/batch evaluations, "open full" trace detail). Replaces
 * each previewed attribute that has a blob ref with the full value fetched from
 * object storage. List/search paths skip this and use the inline preview. ADR-021.
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

    const out = { ...attributes };
    const resolved = await Promise.all(
      keys.map(async (attrKey) => {
        const ref = blobRefs[attrKey]!;
        const full = await this.blobStore.get({ projectId, ref });
        return [attrKey, full] as const;
      }),
    );
    for (const [attrKey, full] of resolved) {
      out[attrKey] = full;
    }
    return out;
  }
}
