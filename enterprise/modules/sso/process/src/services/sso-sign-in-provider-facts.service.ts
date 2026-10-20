// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { EventingCommands } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import { SSO_SIGN_IN_PROVIDER_TENANT_ID } from "../eventing/sso-sign-in-provider.commands.ts";
import type { SsoSignInProviderPipeline } from "../eventing/sso-sign-in-provider.pipeline.ts";
import type { SsoGateLogger } from "./sso-gate.service.ts";

/**
 * Records which sign-in provider this deployment mounted, as sso's own fact; licensing answers
 * the gate status from it (ADR-179). A send that fails is logged and never stops the mount.
 */
export class SsoSignInProviderFactsService {
  #commands: EventingCommands<SsoSignInProviderPipeline> | undefined;

  static create({ logger }: { logger: SsoGateLogger }): SsoSignInProviderFactsService {
    return new SsoSignInProviderFactsService(logger);
  }

  private constructor(private readonly logger: SsoGateLogger) {}

  /** Binds the sso_sign_in_provider pipeline's own sender. */
  connect(commands: EventingCommands<SsoSignInProviderPipeline>): void {
    this.#commands = commands;
  }

  /** `provider` is the configured name, `"email"` for none. */
  async signInProviderMounted({
    provider,
    mounted,
  }: {
    provider: string;
    mounted: boolean;
  }): Promise<void> {
    const commands = this.#commands;
    if (!commands) {
      this.logger.warn({ provider }, "sso_sign_in_provider is not connected; the fact is skipped");
      return;
    }
    try {
      await commands.recordSignInProvider.send({
        tenantId: SSO_SIGN_IN_PROVIDER_TENANT_ID,
        occurredAt: nowInstant().epochMilliseconds,
        provider: provider === "email" ? null : provider,
        mounted,
      });
    } catch (error) {
      this.logger.warn(
        { provider, error: error instanceof Error ? error.message : String(error) },
        "The sign-in provider fact could not be recorded; the gate status keeps its last answer",
      );
    }
  }
}
