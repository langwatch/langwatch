import { getStoredObjectStorageScheme } from "@langwatch/stored-object-contract";
import { UnsupportedStorageSchemeError } from "#errors";

/**
 * Decomposes an `s3://<bucket>/<key>` address into its bucket and key.
 *
 * One parser, because two adapters read the same address and drifted: the
 * byte driver recognised every scheme the platform knows and then sliced as
 * if it were always `s3://`, while the migration driver went through `URL`
 * and percent-encoded any key holding a reserved character. Recognising a
 * scheme is not accepting it, and a key is bytes, not a URL path.
 *
 * @throws {UnsupportedStorageSchemeError} when the address is not an `s3://` one.
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
