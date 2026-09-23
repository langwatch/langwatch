// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoSelfServeContext } from "@langwatch/enterprise-sso-contract";

/**
 * What the installation's licence may authorize (D05 tier 2).
 *
 * The answer is the same gate a sign-in asks, frozen for the same reason: a
 * licence activated while the installation runs does not change what it
 * federates until it restarts. Two readings of "licensed" would eventually
 * disagree, and the disagreement would be about who gets single sign-on.
 *
 * On the hosted service the answer is always no: no instance licence speaks
 * for the installation, and the claim queue is right beside it.
 */
export class LicenseDomainClaimAuthority {
  static create(deps: {
    isHosted: () => boolean;
    licensedAtStartup: () => Promise<boolean>;
  }): LicenseDomainClaimAuthority {
    return new LicenseDomainClaimAuthority(deps);
  }

  private constructor(
    private readonly deps: { isHosted: () => boolean; licensedAtStartup: () => Promise<boolean> },
  ) {}

  async licenseAuthorizesDomainClaims(): Promise<boolean> {
    if (this.deps.isHosted()) return false;

    return this.deps.licensedAtStartup();
  }
}

/**
 * Whether a genuine licence is active RIGHT NOW, asked afresh rather than
 * through the frozen gate — that difference is the whole point, and it is what
 * tells somebody who has just activated a licence to restart.
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

export interface SsoSelfServeContextDeps {
  authority: LicenseDomainClaimAuthority;
  licenseProof: InstanceLicenseProof;
  optIn: SsoSelfServeOptIn;
  isHosted: () => boolean;
}

/**
 * Which tier an organization gets, assembled from the deployment, the frozen
 * licence gate and the per-organization opt-in.
 */
export class SsoSelfServeContextService {
  static create(deps: SsoSelfServeContextDeps): SsoSelfServeContextService {
    return new SsoSelfServeContextService(deps);
  }

  private constructor(private readonly deps: SsoSelfServeContextDeps) {}

  async resolve({ organizationId }: { organizationId: string }): Promise<SsoSelfServeContext> {
    const deployment = this.deps.isHosted() ? "hosted" : "self-hosted";
    const licensed = await this.deps.authority.licenseAuthorizesDomainClaims();

    return {
      deployment,
      licensed,
      licenseActivatedSinceStart:
        deployment === "self-hosted" && !licensed
          ? await this.deps.licenseProof.holdsGenuineLicense()
          : false,
      optedIn:
        deployment === "hosted" ? await this.deps.optIn.isOptedIn({ organizationId }) : false,
    };
  }
}
