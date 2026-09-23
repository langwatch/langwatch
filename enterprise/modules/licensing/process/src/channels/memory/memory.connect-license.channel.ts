import type {
  ActivationAnswer,
  ConnectCredential,
  LicenseSeatCounts,
  LicenseSyncAnswer,
} from "@langwatch/enterprise-licensing-contract";

import { ConnectLicenseChannel } from "../connect-license.channel.ts";

/** One sync as it was made, so a suite can assert what left the install. */
export interface RecordedLicenseSync {
  readonly token: string;
  readonly instanceId: string;
  readonly version: string;
  readonly seats: LicenseSeatCounts;
}

export interface MemoryConnectLicenseChannelOptions {
  /** What a sync answers. A thrown value is thrown instead. */
  readonly syncAnswer?: LicenseSyncAnswer | Error;
  /** What an activation code redeems to. */
  readonly activationAnswer?: ActivationAnswer | Error;
}

/**
 * The connect host, answering from memory. Records every sync so a suite can
 * prove no organization name, hostname or user data left the install.
 */
export class MemoryConnectLicenseChannel extends ConnectLicenseChannel {
  readonly syncs: RecordedLicenseSync[] = [];
  readonly activations: { code: string; instanceId: string }[] = [];

  private constructor(private readonly options: MemoryConnectLicenseChannelOptions) {
    super();
  }

  static create(options: MemoryConnectLicenseChannelOptions = {}): MemoryConnectLicenseChannel {
    return new MemoryConnectLicenseChannel(options);
  }

  async activate({
    code,
    instanceId,
  }: {
    code: string;
    instanceId: string;
    signal?: AbortSignal;
  }): Promise<ActivationAnswer> {
    this.activations.push({ code, instanceId });
    const answer = this.options.activationAnswer;
    if (answer instanceof Error) throw answer;
    if (!answer) throw new Error("this memory channel was composed with no activation answer");
    return answer;
  }

  async syncLicense({
    credential,
    version,
    seats,
  }: {
    credential: ConnectCredential;
    version: string;
    seats: LicenseSeatCounts;
    signal?: AbortSignal;
  }): Promise<LicenseSyncAnswer> {
    this.syncs.push({
      token: credential.token,
      instanceId: credential.instanceId,
      version,
      seats,
    });
    const answer = this.options.syncAnswer;
    if (answer instanceof Error) throw answer;
    return answer ?? { services: [] };
  }
}
