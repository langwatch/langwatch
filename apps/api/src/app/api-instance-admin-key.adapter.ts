import type { ApiConfig } from "../platform/config/api.config";

/**
 * The instance administrator credential, as the REST feature ports read it.
 *
 * The value arrives already parsed: `api.config.ts` is the process's one
 * environment reader, so this adapter never touches `process.env`. What it
 * owns is the credential's own rule, which a config schema has no business
 * encoding — a variable exported blank, or as nothing but whitespace, is a
 * credential the operator has NOT configured, and the provisioning family
 * answers 404 rather than authenticating anyone against an empty string.
 *
 * One difference from the platform's per-request read, stated rather than
 * hidden: the API process parses its configuration once at boot, so a
 * deployment that exports the variable AFTER the process started is not
 * honoured until it restarts. That is the injection discipline the whole
 * package is built on — nothing below the composition root reads the
 * environment — and a restart is what changes a credential anywhere else in
 * this process too.
 */
export class ApiInstanceAdminKeyAdapter {
  static create(options: {
    config: Pick<ApiConfig, "instanceAdminApiKey">;
  }): ApiInstanceAdminKeyAdapter {
    return new ApiInstanceAdminKeyAdapter(options.config.instanceAdminApiKey);
  }

  private constructor(private readonly configured: string | undefined) {}

  /** The configured credential, or nothing when it is unset or blank. */
  read(): string | undefined {
    const trimmed = this.configured?.trim();
    return trimmed ? trimmed : undefined;
  }
}
