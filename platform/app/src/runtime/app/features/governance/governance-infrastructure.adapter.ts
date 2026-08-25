// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceEncryptionPort } from "@langwatch/enterprise-governance-server";
import { decrypt, encrypt } from "~/utils/encryption";

export class AppGovernanceEncryptionPort extends GovernanceEncryptionPort {
  encrypt(value: string): string {
    return encrypt(value);
  }

  decrypt(value: string): string {
    return decrypt(value);
  }
}
