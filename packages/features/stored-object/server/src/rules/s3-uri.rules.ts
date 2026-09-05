import { getStoredObjectStorageScheme } from "@langwatch/stored-object-contract";
import { UnsupportedStorageSchemeError } from "#errors";

/**
 * Decomposes an `s3://<bucket>/<key>` address into its bucket and key.
 */
export function parseS3Uri(uri: string): { bucket: string; key: string } {
  const scheme = getStoredObjectStorageScheme(uri);
  if (scheme !== "s3") {
    throw new UnsupportedStorageSchemeError({ uri, scheme, expectedScheme: "s3" });
  }

  const withoutScheme = uri.slice("s3://".length);
  const slashIndex = withoutScheme.indexOf("/");

  if (slashIndex === -1) {
    throw new Error(`Invalid S3 URI (no key): "${uri}"`);
  }

  const bucket = withoutScheme.slice(0, slashIndex);
  const key = withoutScheme.slice(slashIndex + 1);

  if (!bucket) {
    throw new Error(`Invalid S3 URI (empty bucket): "${uri}"`);
  }
  if (!key) {
    throw new Error(`Invalid S3 URI (empty key): "${uri}"`);
  }

  return { bucket, key };
}
