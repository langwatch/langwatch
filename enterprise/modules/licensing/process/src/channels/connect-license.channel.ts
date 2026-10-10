import type {
  ActivationAnswer,
  ConnectCredential,
  LicenseSeatCounts,
  LicenseSyncAnswer,
} from "@langwatch/enterprise-licensing-contract";

/**
 * The connect host, where an install's license syncs and an activation code is
 * redeemed. What leaves is the version and the two seat counts: no organization
 * name, no hostname, no user data, no statistics (ADR-156, section 6).
 * @see specs/self-hosting/connected-services/license-sync.feature
 */
export abstract class ConnectLicenseChannel {
  /**
   * Redeems an activation code for the license it describes. The code travels
   * in the credential's token slot because it is the whole credential for this
   * one call, exactly as the license token is for a sync.
   */
  abstract activate(params: {
    code: string;
    instanceId: string;
    signal?: AbortSignal;
  }): Promise<ActivationAnswer>;

  abstract syncLicense(params: {
    credential: ConnectCredential;
    version: string;
    seats: LicenseSeatCounts;
    signal?: AbortSignal;
  }): Promise<LicenseSyncAnswer>;
}
