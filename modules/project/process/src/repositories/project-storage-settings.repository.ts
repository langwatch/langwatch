import type { UpdateProjectInput } from "@langwatch/project-contract";

/** The deployment's symmetric cipher, narrowed to what sealing a stored-object credential needs. */
export interface ProjectStorageCipher {
  encrypt(plaintext: string): string;
}

/** The stored-object (S3) settings of one project, as a settings update carries them. */
export type ProjectStorageSettings = Pick<
  UpdateProjectInput,
  "s3Endpoint" | "s3AccessKeyId" | "s3SecretAccessKey" | "s3Bucket"
>;

/**
 * Owns the stored-object columns of a project row. The live backend seals the
 * endpoint, access key and secret before they reach the row; the memory twin
 * holds them as given. A key left out of `settings` is left as it is.
 */
export interface ProjectStorageSettingsRepository {
  /** Writes the settings and answers what the row holds; a project not live there is refused. */
  update(input: {
    projectId: string;
    organizationId: string;
    settings: ProjectStorageSettings;
  }): Promise<ProjectStorageSettings>;
}
