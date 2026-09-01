import { LangySessionKeyReapRepository } from "./langy-session-key-reap.repository";

export type LangySessionKeyRecord = {
  id: string;
  name: string;
  revokedAt: Date | null;
  isScopedToProject: boolean;
};

export abstract class LangySessionKeyRepository extends LangySessionKeyReapRepository {
  abstract tryFindProjectScope(projectId: string): Promise<{
    teamId: string;
    organizationId: string;
  } | null>;

  abstract tryFindById(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<LangySessionKeyRecord | null>;

  abstract revoke(apiKeyId: string, revokedAt: Date): Promise<void>;
}
