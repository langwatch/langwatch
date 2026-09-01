import { OrganizationSettingsSecretPort } from "@langwatch/organization-server";
import type { SecretEncryptionPort } from "@langwatch/secret-server";

/**
 * The organization service's settings cipher, delegated to this process's own.
 *
 * `OrganizationSettingsSecretPort` and `SecretEncryptionPort` are the same two
 * methods over the same at-rest format, and that is not a coincidence worth
 * exploiting quietly: an organization's stored settings and a project's stored
 * secret are encrypted by one algorithm under one key, so a process that
 * satisfied one port with a second cipher would write settings the platform
 * app cannot read.
 *
 * This exists because the two ports live in different packages and neither may
 * depend on the other. What crosses between them is the composition root's
 * decision that they are the same cipher — which is a decision, so it is
 * stated here rather than assumed by an adapter that happens to fit both.
 */
export class ApiOrganizationSettingsSecretAdapter extends OrganizationSettingsSecretPort {
  static create(options: {
    encryption: SecretEncryptionPort;
  }): ApiOrganizationSettingsSecretAdapter {
    return new ApiOrganizationSettingsSecretAdapter(options.encryption);
  }

  private constructor(private readonly encryption: SecretEncryptionPort) {
    super();
  }

  encrypt(value: string): string {
    return this.encryption.encrypt(value);
  }

  decrypt(value: string): string {
    return this.encryption.decrypt(value);
  }
}
