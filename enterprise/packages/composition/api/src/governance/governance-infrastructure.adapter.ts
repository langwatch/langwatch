// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceEncryptor } from "@langwatch/enterprise-governance-server";

/** Encryption remains process members supplied by the API installer. */
export type GovernanceEncryption = {
  encrypt(value: string): string;
  decrypt(value: string): string;
};

export class AppGovernanceEncryption implements GovernanceEncryptor {
  private constructor(private readonly encryption: GovernanceEncryption) {}

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
