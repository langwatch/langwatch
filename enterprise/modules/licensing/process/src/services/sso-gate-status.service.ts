import type { SsoGateStatus } from "@langwatch/enterprise-licensing-contract";
import type { SsoSignInProviderRecordedEventData } from "@langwatch/enterprise-sso-contract";
import { freshnessOf } from "@langwatch/eventing";

import type { SignInProviderMountRepository } from "../repositories/sign-in-provider-mount.repository.ts";

/** Nothing to warn about: no provider recorded yet, or the deployment signs in by email. */
const NOTHING_CONFIGURED: SsoGateStatus = {
  configuredProvider: null,
  licensed: true,
  mounted: true,
};

/**
 * Why a deployment configured for single sign-on is not using it, answered from sso's sign-in
 * provider fact as licensing applied it (ADR-179); whether a licence permits it is licensing's.
 */
export class SsoGateStatusService {
  static create({
    mounts,
    isPlatformSsoLicensed,
  }: {
    mounts: SignInProviderMountRepository;
    isPlatformSsoLicensed: () => Promise<boolean>;
  }): SsoGateStatusService {
    return new SsoGateStatusService(mounts, isPlatformSsoLicensed);
  }

  private constructor(
    private readonly mounts: SignInProviderMountRepository,
    private readonly isPlatformSsoLicensed: () => Promise<boolean>,
  ) {}

  /** Applies sso's fact unless the row already holds it or a newer one. */
  async applySignInProvider({
    provider,
    mounted,
    eventId,
  }: SsoSignInProviderRecordedEventData & { eventId: string }): Promise<void> {
    const [current] = await this.mounts.find();
    if (
      current &&
      freshnessOf({ answerId: current.lastAppliedEventId, hintId: eventId, scope: "aggregate" }) ===
        "fresh"
    ) {
      return;
    }
    await this.mounts.save({ provider, mounted, lastAppliedEventId: eventId });
  }

  async getStatus(): Promise<SsoGateStatus> {
    const [current] = await this.mounts.find();
    if (!current?.provider || current.provider === "email") return NOTHING_CONFIGURED;
    return {
      configuredProvider: current.provider,
      licensed: await this.isPlatformSsoLicensed(),
      mounted: current.mounted,
    };
  }
}
