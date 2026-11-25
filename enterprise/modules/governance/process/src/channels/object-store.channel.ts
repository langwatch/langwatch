// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export type GovernanceObjectStorageCredentials = {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** A role the keys assume before the read, with its external id when the role demands one. */
  assumeRole?: { roleArn: string; externalId?: string };
  /** Sign only with the keys above, never with the deployment's own identity. */
  requireStaticKeys?: boolean;
};

export interface GovernanceObjectStore {
  list(input: {
    bucket: string;
    prefix: string;
    region: string;
    endpoint?: string;
    startAfter?: string;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
    limit: number;
    /**
     * `isTruncated` is returned rather than inferred from `keys.length`: a
     * listing that exactly hits the cap is indistinguishable from one cut
     * short by it, and inferring it would re-derive a rule that lives here.
     */
  }): Promise<{ keys: string[]; isTruncated: boolean }>;

  readText(input: {
    bucket: string;
    key: string;
    region: string;
    endpoint?: string;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
    maxBytes: number;
  }): Promise<string>;

  /** The object's bytes, for binary formats such as Parquet. */
  readBytes(input: Parameters<GovernanceObjectStore["readText"]>[0]): Promise<Uint8Array>;
}
