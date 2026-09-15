/** Langy credential persistence. The database shape stays private to server. */
export abstract class LangyCredentialRepository {
  abstract tryFindProject(projectId: string): Promise<{ organizationId: string } | null>;

  abstract tryFindVirtualKeyConfig(input: {
    projectId: string;
    organizationId: string;
  }): Promise<unknown | null>;

  abstract tryFindEgressAllowlist(projectId: string): Promise<unknown | null>;

  abstract saveEgressAllowlist(projectId: string, allowlist: string[] | null): Promise<void>;
}
