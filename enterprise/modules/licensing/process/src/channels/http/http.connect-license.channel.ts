import {
  type ActivationAnswer,
  type ConnectCredential,
  type LicenseSeatCounts,
  type LicenseSyncAnswer,
  type UpgradeDiagnosticsReceipt,
  type UpgradeDiagnosticsSubmission,
  connectActivationAnswerSchema,
  upgradeDiagnosticsReceiptSchema,
  connectSyncAnswerSchema,
} from "@langwatch/enterprise-licensing-contract";

import { ConnectLicenseChannel } from "../connect-license.channel.ts";
import { type ConnectHostOptions, ConnectHost } from "./http.connect-host.channel.ts";

/** Origin of the connect host; the paths are this channel's own. */
type HttpConnectLicenseChannelOptions = ConnectHostOptions;

/** The routes the connect host answers, over the shared transport. */
export class HttpConnectLicenseChannel extends ConnectLicenseChannel {
  private constructor(private readonly host: ConnectHost) {
    super();
  }

  static create(options: HttpConnectLicenseChannelOptions): HttpConnectLicenseChannel {
    return new HttpConnectLicenseChannel(new ConnectHost(options));
  }

  async activate({
    code,
    instanceId,
    signal,
  }: {
    code: string;
    instanceId: string;
    signal?: AbortSignal;
  }): Promise<ActivationAnswer> {
    return this.host.call({
      path: "/v1/license/activate",
      method: "POST",
      credential: { token: code, instanceId },
      body: {},
      schema: connectActivationAnswerSchema,
      ...(signal ? { signal } : {}),
    });
  }

  async syncLicense({
    credential,
    version,
    seats,
    signal,
  }: {
    credential: ConnectCredential;
    version: string;
    seats: LicenseSeatCounts;
    signal?: AbortSignal;
  }): Promise<LicenseSyncAnswer> {
    const answer = await this.host.call({
      path: "/v1/license/sync",
      method: "POST",
      credential,
      body: { version, seats: { members: seats.members, liteMembers: seats.liteMembers } },
      schema: connectSyncAnswerSchema,
      ...(signal ? { signal } : {}),
    });
    return {
      services: answer.services,
      ...(answer.license ? { license: answer.license } : {}),
    };
  }

  async sendUpgradeDiagnostics({
    credential,
    submission,
    signal,
  }: {
    credential: ConnectCredential;
    submission: UpgradeDiagnosticsSubmission;
    signal?: AbortSignal;
  }): Promise<UpgradeDiagnosticsReceipt> {
    return this.host.call({
      path: "/v1/upgrade-diagnostics",
      method: "POST",
      credential,
      body: submission,
      schema: upgradeDiagnosticsReceiptSchema,
      ...(signal ? { signal } : {}),
    });
  }
}
