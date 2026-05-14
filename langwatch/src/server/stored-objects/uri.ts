/**
 * Content-addressed URI helpers for stored objects.
 *
 * Supported schemes:
 *   s3://   — objects stored in an S3-compatible bucket
 *   file:// — objects stored on the local filesystem
 */

const SUPPORTED_SCHEMES = ["s3", "file"] as const;
type UriScheme = (typeof SUPPORTED_SCHEMES)[number];

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
  return `s3://${bucket}/${projectId}/${sha256}`;
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
  const normalizedRoot = root.startsWith("/") ? root : `/${root}`;
  return `file://${normalizedRoot}/${projectId}/${sha256}`;
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
