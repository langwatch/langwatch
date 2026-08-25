export type GovernanceObjectStorageCredentials = {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

export abstract class GovernanceObjectStoragePort {
  abstract list(input: {
    bucket: string;
    prefix: string;
    region: string;
    startAfter?: string;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
    limit: number;
  }): Promise<string[]>;

  abstract readText(input: {
    bucket: string;
    key: string;
    region: string;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
    maxBytes: number;
  }): Promise<string>;
}
