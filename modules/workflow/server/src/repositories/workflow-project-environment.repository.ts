/**
 * The stored rows a Studio run's environment is built from: the project's API
 * key and its project-scoped secrets, as they are stored.
 *
 * The secrets come back encrypted. Decryption is a process capability rather
 * than a stored row, so the cipher belongs to the service above this seam and
 * a repository never carries one.
 */

/** One project-scoped secret, as the row holds it. */
export type StoredProjectSecret = Readonly<{
  name: string;
  encryptedValue: string;
}>;

/** A project's stored run environment, before any value is decrypted. */
export type StoredProjectEnvironment = Readonly<{
  apiKey: string;
  secrets: readonly StoredProjectSecret[];
}>;

export abstract class WorkflowProjectEnvironmentRepository {
  abstract findEnvironment(input: { projectId: string }): Promise<StoredProjectEnvironment>;
}
