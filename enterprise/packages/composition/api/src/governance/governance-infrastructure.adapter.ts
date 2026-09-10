// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceEncryptionPort } from "@langwatch/enterprise-governance-server";

/** Encryption remains process infrastructure supplied by the API installer. */
export type GovernanceEncryption = {
  encrypt(value: string): string;
  decrypt(value: string): string;
};

export class AppGovernanceEncryption extends GovernanceEncryptionPort {
  private constructor(private readonly encryption: GovernanceEncryption) {
    super();
  }

  static create(encryption: GovernanceEncryption): AppGovernanceEncryption {
    return new AppGovernanceEncryption(encryption);
  }

  encrypt(value: string): string {
    return this.encryption.encrypt(value);
  }

  decrypt(value: string): string {
    return this.encryption.decrypt(value);
  }
}
