// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ProjectWeekState, UserWeekState } from "../../rules/digest-week.rules.ts";
import type { DigestRepositories } from "../digest.repositories.ts";
import { MemoryDigestAudienceRepository } from "./memory.digest-audience.repository.ts";
import { MemoryDigestSendRepository } from "./memory.digest-send.repository.ts";
import { MemoryDigestWeekRepository } from "./memory.digest-week.repository.ts";

export class MemoryDigestRepositories {
  static readonly requires = [] as const;

  static create(): DigestRepositories {
    return {
      projectWeeks: MemoryDigestWeekRepository.create<ProjectWeekState>(),
      userWeeks: MemoryDigestWeekRepository.create<UserWeekState>(),
      sends: MemoryDigestSendRepository.create(),
      audience: MemoryDigestAudienceRepository.create(),
    };
  }
}
