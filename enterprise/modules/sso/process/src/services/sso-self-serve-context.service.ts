// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type {
  SsoSelfServeAvailability,
  SsoSelfServeContext,
} from "@langwatch/enterprise-sso-contract";
import {
  SsoLicenseRequiredError,
  SsoSelfServeUnavailableError,
} from "@langwatch/identity-contract";

import { ssoSelfServeAvailability } from "../rules/sso-self-serve-availability.rules.ts";

/**
 * What the installation's licence may authorize (D05 tier 2).
 *
 * The answer is the same gate a sign-in asks (ADR-027 v9: a deny is read again
 * within a minute). Two readings of "licensed" would eventually disagree, and
 * the disagreement would be about who gets single sign-on.
 *
 * On the hosted service the answer is always no: no instance licence speaks
 * for the installation, and the claim queue is right beside it.
 */
export class LicenseDomainClaimAuthority {
  static create(deps: LicenseDomainClaimAuthorityDeps): LicenseDomainClaimAuthority {
    return new LicenseDomainClaimAuthority(deps);
  }

  private constructor(private readonly deps: LicenseDomainClaimAuthorityDeps) {}

  async licenseAuthorizesDomainClaims(): Promise<boolean> {
    if (this.deps.isHosted()) return false;

    return this.deps.licenseGate();
  }

  /** The count the guards ask too, so the screen and the rule agree on it. */
  async hostsSingleOrganization(): Promise<boolean> {
    if (this.deps.isHosted()) return false;

    return (await this.deps.licensing.getDomainClaimAuthority()).hostsSingleOrganization;
  }
}

export interface LicenseDomainClaimAuthorityDeps {
  isHosted: () => boolean;
  licenseGate: () => Promise<boolean>;
  licensing: Pick<LicensingApi, "getDomainClaimAuthority">;
}

/**
 * Whether a genuine licence is active RIGHT NOW, asked afresh rather than
 * through the gate's memo: it is what tells somebody who has just activated a
 * licence that single sign-on turns on within a minute.
 *
 * Expiry is deliberately irrelevant, exactly as it is for the sign-in gate
 * (ADR-027 decision 1): once a customer, never blocked.
 */
export class InstanceLicenseProof {
  static create(deps: {
    licensing: Pick<LicensingApi, "inspectPlatformAccess">;
  }): InstanceLicenseProof {
    return new InstanceLicenseProof(deps);
  }

  private constructor(
    private readonly deps: {
      licensing: Pick<LicensingApi, "inspectPlatformAccess">;
    },
  ) {}

  async holdsGenuineLicense(): Promise<boolean> {
    const access = await this.deps.licensing.inspectPlatformAccess();

    return access.allowed;
  }
}

/** Whether this organization was opted in to setting single sign-on up itself. */
export interface SsoSelfServeOptIn {
  isOptedIn(input: { organizationId: string }): Promise<boolean>;
}

/** Who counts as a platform operator (holds the platform grant). */
export interface SsoPlatformOperators {
  isPlatformOperator(input: { actorId: string }): Promise<boolean>;
}

export interface SsoSelfServeContextDeps {
  authority: LicenseDomainClaimAuthority;
  licenseProof: InstanceLicenseProof;
  optIn: SsoSelfServeOptIn;
  platformOperators: SsoPlatformOperators;
  isHosted: () => boolean;
}

/** Who is asking, absent where nobody in particular is: a platform operator is
 *  offered a proof an organization administrator is not. */
type SelfServeContextInput = { organizationId: string; actorId?: string };

/**
 * Which tier an organization gets, assembled from the deployment, the frozen
 * licence gate and the per-organization opt-in.
 */
export class SsoSelfServeContextService {
  static create(deps: SsoSelfServeContextDeps): SsoSelfServeContextService {
    return new SsoSelfServeContextService(deps);
  }

  private constructor(private readonly deps: SsoSelfServeContextDeps) {}

  async resolve({ organizationId, actorId }: SelfServeContextInput): Promise<SsoSelfServeContext> {
    const deployment = this.deps.isHosted() ? "hosted" : "self-hosted";
    const licensed = await this.deps.authority.licenseAuthorizesDomainClaims();
    const { singleOrganization, actorIsPlatformOperator } =
      deployment === "self-hosted" && licensed
        ? await this.whoTheLicenseSpeaksFor({ actorId })
        : { singleOrganization: false, actorIsPlatformOperator: false };

    return {
      deployment,
      licensed,
      licenseActivationPending:
        deployment === "self-hosted" && !licensed
          ? await this.deps.licenseProof.holdsGenuineLicense()
          : false,
      optedIn:
        deployment === "hosted" ? await this.deps.optIn.isOptedIn({ organizationId }) : false,
      singleOrganization,
      actorIsPlatformOperator,
    };
  }

  async availability(input: SelfServeContextInput): Promise<SsoSelfServeAvailability> {
    return ssoSelfServeAvailability(await this.resolve(input));
  }

  /** Setup is available, or refused with the one thing that would change that. */
  async assertAvailable(
    input: SelfServeContextInput,
  ): Promise<Extract<SsoSelfServeAvailability, { available: true }>> {
    const { organizationId } = input;
    const availability = await this.availability(input);
    if (availability.available) return availability;
    if (availability.refusal === "not_opted_in") {
      throw new SsoSelfServeUnavailableError(
        `organization ${organizationId} is not opted in to self-serve single sign-on setup`,
      );
    }
    throw new SsoLicenseRequiredError(
      availability.refusal === "license_activation_pending"
        ? `organization ${organizationId}: a license was activated and has not reached this process's gate yet`
        : `organization ${organizationId}: the installation holds no genuine license`,
    );
  }

  /** Asked only on a licensed self-hosted installation, and the operator only
   *  where there is more than one organization for it to matter. */
  private async whoTheLicenseSpeaksFor({
    actorId,
  }: {
    actorId?: string;
  }): Promise<{ singleOrganization: boolean; actorIsPlatformOperator: boolean }> {
    const singleOrganization = await this.deps.authority.hostsSingleOrganization();
    if (singleOrganization || actorId === undefined) {
      return { singleOrganization, actorIsPlatformOperator: false };
    }

    return {
      singleOrganization,
      actorIsPlatformOperator: await this.deps.platformOperators.isPlatformOperator({ actorId }),
    };
  }
}
