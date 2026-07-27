/**
 * URI helpers for stored objects.
 *
 * Supported schemes:
 *   s3://         — objects stored in an S3-compatible bucket
 *   file://       — objects stored on the local filesystem
 *   azure-blob:// — objects stored in an Azure Blob Storage container
 */

import type { ProjectStorageDestination } from "./project-storage-destination";

export const SUPPORTED_SCHEMES = ["s3", "file", "azure-blob"] as const;
export type UriScheme = (typeof SUPPORTED_SCHEMES)[number];

/**
 * Mints the URI for `objectPath` at whichever backend `destination` names.
 *
 * `objectPath` is the COMPLETE path below the container/bucket/root — the
 * caller owns its whole shape, including any tenant segment. That is
 * deliberate: content-addressed callers want `{projectId}/{sha256}`, while the
 * ADR-022 trace spool wants a stable top-level `trace-blobs/spool/…` prefix so
 * a bucket lifecycle rule can match it (an S3 lifecycle prefix filter cannot
 * wildcard a leading tenant segment). Pinning the layout here would have forced
 * one of them to move.
 *
 * This is the single source of truth for the destination → URI mapping. It
 * previously existed as three separate switch statements (content-addressed
 * stored objects, the GroupQueue durable blob tier, and — missing entirely —
 * the trace spool); a new backend had to be added to each, and the spool's
 * absence from the list is exactly how it ended up hardcoded to S3
 * (langwatch/langwatch-saas#800).
 */
export function mintUriForDestination({
  destination,
  objectPath,
}: {
  destination: ProjectStorageDestination;
  objectPath: string;
}): string {
  switch (destination.kind) {
    case "s3":
      return `s3://${destination.bucket}/${objectPath}`;
    case "file": {
      // Normalised so a root configured without a leading slash still produces
      // an absolute `file:///…` URI rather than a relative one.
      const normalizedRoot = destination.root.startsWith("/")
        ? destination.root
        : `/${destination.root}`;
      return `file://${normalizedRoot}/${objectPath}`;
    }
    case "azure":
      return `azure-blob://${destination.accountName}/${destination.container}/${objectPath}`;
    default: {
      const unhandled: never = destination;
      throw new Error(
        `Unhandled storage destination kind: ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/**
 * Mints an S3 content-addressed URI.
 *
 * @returns `s3://{bucket}/{projectId}/{sha256}`
 */
export function mintS3Uri({
  bucket,
  projectId,
  sha256,
}: {
  bucket: string;
  projectId: string;
  sha256: string;
}): string {
  return mintUriForDestination({
    destination: { kind: "s3", bucket },
    objectPath: `${projectId}/${sha256}`,
  });
}

/**
 * Mints a local-filesystem content-addressed URI.
 *
 * Normalises `root` so it always starts with a leading `/`.
 *
 * @returns `file:///{normalizedRoot}/{projectId}/{sha256}`
 */
export function mintFileUri({
  root,
  projectId,
  sha256,
}: {
  root: string;
  projectId: string;
  sha256: string;
}): string {
  return mintUriForDestination({
    destination: { kind: "file", root },
    objectPath: `${projectId}/${sha256}`,
  });
}

/**
 * Mints an Azure-Blob content-addressed URI.
 *
 * Azure has containers (the rough analogue of an S3 bucket) and blobs
 * (the analogue of an S3 key). We encode the account name in the
 * host position so a single deployment can address multiple storage
 * accounts side-by-side if needed.
 *
 * @returns `azure-blob://{accountName}/{container}/{projectId}/{sha256}`
 */
export function mintAzureBlobUri({
  accountName,
  container,
  projectId,
  sha256,
}: {
  accountName: string;
  container: string;
  projectId: string;
  sha256: string;
}): string {
  return mintUriForDestination({
    destination: { kind: "azure", accountName, container },
    objectPath: `${projectId}/${sha256}`,
  });
}

/**
 * Extracts and validates the URI scheme.
 *
 * @throws if the scheme is not one of the supported values.
 */
export function getUriScheme(uri: string): UriScheme {
  const colonIndex = uri.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Unrecognised URI scheme in "${uri}": no colon found`);
  }

  const scheme = uri.slice(0, colonIndex);

  if (!SUPPORTED_SCHEMES.includes(scheme as UriScheme)) {
    throw new Error(
      `Unrecognised URI scheme "${scheme}" in "${uri}". Supported: ${SUPPORTED_SCHEMES.join(", ")}`,
    );
  }

  return scheme as UriScheme;
}
