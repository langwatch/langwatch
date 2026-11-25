import { IdentityIdentifierNotFoundError } from "@langwatch/identity-contract";

import type {
  IdentityAccountRow,
  IdentityAccounts,
  IdentityResolution,
  IdentityResolver,
} from "../../rules/identity-storage.rules.ts";
import { IdentityConnectionIssuersRepository } from "../identity-connection-issuers.repository.ts";
import {
  IdentityPasskeyRemovalRepository,
  type PasskeyRemovalOutcome,
} from "../identity-passkey-removal.repository.ts";

// ponytail: the memory tier holds no identifiers or connections, so these twins answer nothing;
// suites that drive the identity branch use __tests__/support/in-memory-identity-storage.ts.
export class MemoryIdentityAccountsRepository implements IdentityAccounts {
  static create(): MemoryIdentityAccountsRepository {
    return new MemoryIdentityAccountsRepository();
  }

  private constructor() {}

  async findByUser(): Promise<IdentityAccountRow[]> {
    return [];
  }

  async findByAccountIds(): Promise<IdentityAccountRow[]> {
    return [];
  }

  async getAccountByProviderSubject(): Promise<IdentityAccountRow> {
    throw new IdentityIdentifierNotFoundError("the memory tier holds no identity accounts");
  }

  async createCredential(): Promise<void> {}

  async updateCredentials(): Promise<void> {}

  async deleteCredentials(): Promise<number> {
    return 0;
  }

  async mirrorSecretsOntoAccounts(): Promise<void> {}

  async deleteBridgeAccounts(): Promise<number> {
    return 0;
  }
}

export class MemoryIdentityResolutionRepository implements IdentityResolver {
  static create(): MemoryIdentityResolutionRepository {
    return new MemoryIdentityResolutionRepository();
  }

  private constructor() {}

  async getResolutionByIdentifierValue(): Promise<IdentityResolution> {
    throw new IdentityIdentifierNotFoundError("the memory tier resolves nobody");
  }

  async getResolutionByProviderSubject(): Promise<IdentityResolution> {
    throw new IdentityIdentifierNotFoundError("the memory tier resolves nobody");
  }

  async getResolutionByIssuerSubject(): Promise<IdentityResolution & { providerId: string }> {
    throw new IdentityIdentifierNotFoundError("the memory tier resolves nobody");
  }
}

export class MemoryIdentityConnectionIssuersRepository extends IdentityConnectionIssuersRepository {
  async findProviderIdsForIssuer(): Promise<string[]> {
    return [];
  }

  async findRegisteredIssuers(): Promise<string[]> {
    return [];
  }
}

export class MemoryIdentityPasskeyRemovalRepository extends IdentityPasskeyRemovalRepository {
  async deleteIfAnotherWayInRemains(): Promise<PasskeyRemovalOutcome> {
    return "not_found";
  }
}
