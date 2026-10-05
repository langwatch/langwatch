// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export type GovernanceObjectStorageCredentials = {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
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
}
