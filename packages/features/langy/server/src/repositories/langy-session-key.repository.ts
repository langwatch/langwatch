export type LangySessionKeyRecord = {
  id: string;
  name: string;
  revokedAt: Date | null;
  isScopedToProject: boolean;
};

export abstract class LangySessionKeyRepository {
  abstract tryFindProjectScope(projectId: string): Promise<{
    teamId: string;
    organizationId: string;
  } | null>;

  abstract tryFindById(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<LangySessionKeyRecord | null>;

  abstract revoke(apiKeyId: string, revokedAt: Date): Promise<void>;

  abstract reapExpired(revokedAt: Date, name: string): Promise<number>;
}
