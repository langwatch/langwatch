/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/enterprise-licensing-server`, which a web package may not import
 * even for a type.
 *
 * THE SEGMENT NAME IS LOAD-BEARING. `license` is a mount point on the root
 * router and tRPC hashes that path into the React Query cache key; spell it
 * differently and these hooks stop sharing a cache with the `api.license.*`
 * call sites that have not moved — the Usage page's self-hosted branch among
 * them.
 *
 * `LicenseStatus` IS THE PRODUCER'S OWN TYPE, declared in
 * `@langwatch/enterprise-licensing-contract` and returned by
 * `LicensingApp.getLicenseStatus`, so widening what a license reports is a
 * compile error at the producer rather than a blank card here.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type { LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";
import type { PlanType } from "../plan-form-defaults";

/** The organization every license procedure is scoped to. */
type OrganizationScope = { organizationId: string };

/** The plan template a minted key carries, as the generator form fills it in. */
export type LicenseMintInput = OrganizationScope & {
  privateKey: string;
  organizationName: string;
  email: string;
  expiresAt: Date;
  planType: PlanType;
  plan: Record<string, unknown>;
};

export type LicensingApiMap = {
  license: {
    getStatus: {
      query: { input: OrganizationScope; output: LicenseStatus };
    };

    upload: {
      mutation: {
        input: OrganizationScope & { licenseKey: string };
        output: { success: boolean };
      };
    };

    remove: {
      mutation: { input: OrganizationScope; output: { success: boolean; removed: boolean } };
    };

    /** Mints and signs a key from a private key the operator supplies. */
    generate: {
      mutation: { input: LicenseMintInput; output: { licenseKey: string } };
    };
  };
};

/**
 * The licensing family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy.
 */
export const licensingApi = createFeatureApi<LicensingApiMap>();
