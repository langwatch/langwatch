import { AesGcmSecretEncryptionAdapter, type SecretEncryptionPort } from "@langwatch/secret-server";

export type ApiSecretEncryptionInfrastructureOptions = {
  /** The 32-byte hex key this process was configured with, if it was given one. */
  key: string | undefined;
};

/** Reports the composition decision an unconfigured key would otherwise hide. */
export abstract class ApiSecretEncryptionAbsenceReportPort {
  abstract absent(): void;
}

/**
 * API-owned construction of the stored-secret cipher.
 *
 * There is no algorithm here, and that is the point. The cipher itself is
 * `@langwatch/secret-server`'s, beside the port it satisfies, so rows this
 * process writes are the rows the platform app reads; what this class owns is
 * the one thing that is a process's own — whether this deployment was given a
 * key, and what to do when it was not.
 *
 * Composing the cipher is not composing the secret service. What it unlocks is
 * the second of the two things a `PostgresSecretAdapter` needs, the first
 * being the guarded client {@link ApiDatabaseInfrastructure} composes.
 */
export class ApiSecretEncryptionInfrastructure {
  /**
   * Composes the cipher only when a key is configured.
   *
   * The API process serves its lifecycle surface without one, so an absent
   * `CREDENTIALS_SECRET` is a process with fewer services rather than a dead
   * one, and the caller is told it happened. A key that IS configured and
   * unusable still fails at boot: `create` refuses a blank string, and the
   * cipher refuses a key that is not 32 bytes of hex, rather than composing a
   * service whose first customer read is what discovers the problem.
   */
  static tryCreate(
    options: ApiSecretEncryptionInfrastructureOptions & {
      report?: ApiSecretEncryptionAbsenceReportPort;
    },
  ): ApiSecretEncryptionInfrastructure | undefined {
    if (!options.key?.trim()) {
      options.report?.absent();
      return undefined;
    }
    return ApiSecretEncryptionInfrastructure.create(options);
  }

  static create(
    options: ApiSecretEncryptionInfrastructureOptions,
  ): ApiSecretEncryptionInfrastructure {
    const key = options.key?.trim();
    if (!key) {
      throw new Error("API secret encryption requires a configured key: set CREDENTIALS_SECRET.");
    }
    return new ApiSecretEncryptionInfrastructure(AesGcmSecretEncryptionAdapter.create({ key }));
  }

  private constructor(readonly encryption: SecretEncryptionPort) {}
}
