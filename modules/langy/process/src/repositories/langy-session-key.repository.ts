import type { Instant } from "@langwatch/time";

import { LangySessionKeyReapRepository } from "./langy-session-key-reap.repository.ts";

export type LangySessionKeyRecord = {
  id: string;
  name: string;
  revokedAt: Instant | null;
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

  abstract revoke(apiKeyId: string, revokedAt: Instant): Promise<void>;
}
