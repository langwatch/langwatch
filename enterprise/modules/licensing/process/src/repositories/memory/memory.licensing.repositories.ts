import type { LicensingRepositories } from "../licensing.repositories.ts";
import { MemoryActivationCodeRepository } from "./memory.activation-code.repository.ts";
import { MemoryConnectOrganizationRepository } from "./memory.connect-organization.repository.ts";
import { MemoryInstanceIdentityRepository } from "./memory.instance-identity.repository.ts";
import { MemoryIssuedLicenseRepository } from "./memory.issued-license.repository.ts";
import { MemoryLicensingRateLimitRepository } from "./memory.licensing-rate-limit.repository.ts";
import { MemoryOrganizationLicenseRepository } from "./memory.organization-license.repository.ts";
import { MemorySelfHostedInstanceRepository } from "./memory.self-hosted-instance.repository.ts";

/** The twins, each empty. No cipher: a reissued license is held as written. */
export class MemoryLicensingRepositories {
  static readonly requires = [] as const;

  static create(): LicensingRepositories {
    return {
      organizationLicenses: MemoryOrganizationLicenseRepository.create(),
      issuedLicenses: MemoryIssuedLicenseRepository.create(),
      activationCodes: MemoryActivationCodeRepository.create(),
      selfHostedInstances: MemorySelfHostedInstanceRepository.create(),
      connectOrganizations: MemoryConnectOrganizationRepository.create(),
      instanceIdentity: MemoryInstanceIdentityRepository.create(),
      rateLimits: MemoryLicensingRateLimitRepository.create(),
    };
  }
}
