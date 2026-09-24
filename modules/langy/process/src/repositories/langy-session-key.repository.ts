import type { Instant } from "@langwatch/time";

import { LangySessionKeyReapRepository } from "./langy-session-key-reap.repository.ts";

export type LangySessionKeyRecord = {
  id: string;
  name: string;
  revokedAt: Instant | null;
  isScopedToProject: boolean;
};

export abstract class LangySessionKeyRepository extends LangySessionKeyReapRepository {
  /** Throws `ProjectNotFoundError` when the project or its team is missing. */
  abstract getProjectScope(projectId: string): Promise<{
    teamId: string;
    organizationId: string;
  }>;

  /** Throws `ApiKeyNotFoundError` when no key has this id. */
  abstract getById(input: { apiKeyId: string; projectId: string }): Promise<LangySessionKeyRecord>;

  abstract revoke(apiKeyId: string, revokedAt: Instant): Promise<void>;
}
