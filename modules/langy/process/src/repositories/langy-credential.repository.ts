/** Langy credential persistence. The database shape stays private to server. */
export abstract class LangyCredentialRepository {
  /** Throws `LangyCredentialResolutionError` when the project, or its team, does not exist. */
  abstract getProject(projectId: string): Promise<{ organizationId: string }>;

  /** The latest active Langy key's config, or none. */
  abstract findVirtualKeyConfigs(input: {
    projectId: string;
    organizationId: string;
  }): Promise<unknown[]>;

  /** The project's stored allow-list, or none when it has never set one. */
  abstract findEgressAllowlists(projectId: string): Promise<unknown[]>;

  abstract saveEgressAllowlist(projectId: string, allowlist: string[] | null): Promise<void>;
}
