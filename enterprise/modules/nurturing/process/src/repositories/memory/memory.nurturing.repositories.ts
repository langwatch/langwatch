// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { nowInstant } from "@langwatch/time";

import type { NurturingClaimRepository } from "../nurturing-claim.repository.ts";
import type { NurturingRepositories } from "../nurturing.repositories.ts";
import { MemoryNurturingErasedUserRepository } from "./memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingEvaluationDayRepository } from "./memory.nurturing-evaluation-day.repository.ts";
import { MemoryNurturingVirtualKeyRepository } from "./memory.nurturing-gateway-key.repository.ts";
import { MemoryNurturingMilestonesRepository } from "./memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "./memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "./memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingOrganizationPlanRepository } from "./memory.nurturing-organization-plan.repository.ts";
import { MemoryNurturingPersonalProjectRepository } from "./memory.nurturing-personal-project.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "./memory.nurturing-project-directory.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "./memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "./memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "./memory.nurturing-trace-day.repository.ts";
import { MemoryNurturingTracedProjectRepository } from "./memory.nurturing-traced-project.repository.ts";

/** One claim per key, lapsing when its window does, as the Redis key expires. */
export class MemoryNurturingClaimRepository implements NurturingClaimRepository {
  readonly #claimedUntil = new Map<string, number>();

  static create(): MemoryNurturingClaimRepository {
    return new MemoryNurturingClaimRepository();
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const now = nowInstant().epochMilliseconds;
    const until = this.#claimedUntil.get(key);
    if (until !== undefined && until > now) return false;
    this.#claimedUntil.set(key, now + ttlSeconds * 1000);
    return true;
  }

  async release(key: string): Promise<void> {
    this.#claimedUntil.delete(key);
  }
}

export class MemoryNurturingRepositories {
  static readonly requires = [] as const;

  static create(): NurturingRepositories {
    // One mark set for every copy, as they share one table in Postgres.
    const erasedUsers = MemoryNurturingErasedUserRepository.create();
    return {
      erasedUsers,
      milestones: MemoryNurturingMilestonesRepository.create({ erasedUsers }),
      projects: MemoryNurturingProjectDirectoryRepository.create(),
      placements: MemoryNurturingProjectPlacementRepository.create(),
      organizationsCreated: MemoryNurturingOrganizationCreatedRepository.create(),
      members: MemoryNurturingOrganizationMemberRepository.create({ erasedUsers }),
      plans: MemoryNurturingOrganizationPlanRepository.create(),
      virtualKeys: MemoryNurturingVirtualKeyRepository.create({ erasedUsers }),
      projectUsage: MemoryNurturingProjectUsageRepository.create(),
      traceDays: MemoryNurturingTraceDayRepository.create(),
      evaluationDays: MemoryNurturingEvaluationDayRepository.create(),
      personalProjects: MemoryNurturingPersonalProjectRepository.create({ erasedUsers }),
      tracedProjects: MemoryNurturingTracedProjectRepository.create(),
      claims: MemoryNurturingClaimRepository.create(),
    };
  }
}
