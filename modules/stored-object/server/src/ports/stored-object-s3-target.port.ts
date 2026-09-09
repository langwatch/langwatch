/**
 * Where one project's S3 bytes actually go: the endpoint, region and
 * credentials its objects are written and read through.
 *
 * Separate from {@link StoredObjectProjectS3ConfigPort}, which answers only
 * the BUCKET a destination is minted against. This one answers the CONNECTION,
 * and the two are different questions: a BYOC tenant's bucket lives on the
 * tenant's own endpoint with the tenant's own credentials, and a URI minted
 * against that bucket is unreadable through the deployment's shared client.
 */
export type StoredObjectS3Credentials = Readonly<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}>;

export type StoredObjectS3Target = Readonly<{
  endpoint?: string;
  region?: string;
  credentials?: StoredObjectS3Credentials;
}>;

/** Resolves the S3 connection one project's objects are reached through. */
export abstract class StoredObjectS3TargetPort {
  abstract resolve(projectId: string): Promise<StoredObjectS3Target>;
}
