/** Tenant-prefixed, ordered chunk key for the object-backed dataset layout. */
export const chunkKey = (projectId: string, datasetId: string, index: number): string =>
  `datasets/${projectId}/${datasetId}/chunk-${String(index).padStart(5, "0")}.jsonl`;

/**
 * Guard against `..` / `/` in an id segment before it is interpolated into
 * an object key or filesystem path. Shared by every storage implementation so
 * the traversal invariant (I-TENANT) is enforced in exactly one place.
 */
export const assertNoTraversal = (...parts: string[]): void => {
  for (const part of parts) {
    if (part.includes("..") || part.includes("/")) {
      throw new Error("Invalid id: path traversal attempt detected");
    }
  }
};

/**
 * Guard a full storage key (which legitimately contains `/`) before it is
 * path-joined to disk or sent to S3. Defence-in-depth on the staged-object
 * methods (m4): the key is server-minted, but validate anyway - reject any
 * `..` segment and require it to sit under this project's `staging/` prefix so
 * a key can never escape the tenant scope.
 */
export const assertKeyWithinProject = (projectId: string, key: string): void => {
  assertNoTraversal(projectId);
  if (key.includes("..") || key.startsWith("/") || !key.startsWith(`staging/${projectId}/`)) {
    throw new Error("Invalid key: path traversal attempt detected");
  }
};
