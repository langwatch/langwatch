// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestAudienceRepository } from "./digest-audience.repository.ts";
import type { DigestSendRepository } from "./digest-send.repository.ts";
import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
} from "./digest-week.repository.ts";

/** The rows digest owns, chosen once at boot. */
export interface DigestRepositories {
  readonly projectWeeks: DigestProjectWeekRepository;
  readonly userWeeks: DigestUserWeekRepository;
  readonly sends: DigestSendRepository;
  readonly audience: DigestAudienceRepository;
}
