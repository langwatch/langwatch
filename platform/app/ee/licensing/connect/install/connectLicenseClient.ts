/**
 * The install's client for the connect host, where its license syncs
 * (ADR-139, section 6).
 *
 * One route. The install reports the version it runs and the two seat counts
 * in use, and LangWatch answers with a signed lease, plus a reissued license
 * when one is waiting. Nothing else is sent: no organization name, no
 * hostname, no user data and no product statistics, which are a separate and
 * optional post.
 *
 * @see ./connectTransport.ts, how a call is made and how a refusal is named
 * @see ../lease.ts, the lease this answers with
 * @see ../../../../../specs/self-hosting/connected-services/license-sync.feature
 */

import type { Dispatcher } from "undici";
import { z } from "zod";

import { type SignedLease, signedLeaseSchema } from "../lease";
import { type ConnectCredential, ConnectHttp } from "./connectTransport";

/** The seats in use, as the install counts them. */
export interface LicenseSeatCounts {
  readonly members: number;
  readonly liteMembers: number;
}

const syncAnswerSchema = z.object({
  lease: signedLeaseSchema,
  /** A reissued license waiting for this install, sent until it is presented. */
  license: z.string().optional(),
});

export interface LicenseSyncAnswer {
  readonly lease: SignedLease;
  readonly license?: string;
}

const activateAnswerSchema = z.object({
  license: z.string().min(1),
  planType: z.string(),
  maxMembers: z.number(),
  expiresAt: z.string(),
  services: z.array(z.string()),
});

/** The license an activation code minted, as it comes back. */
export interface ActivationAnswer {
  readonly license: string;
  readonly planType: string;
  readonly maxMembers: number;
  readonly expiresAt: string;
  readonly services: string[];
}

export interface ConnectLicenseClientOptions {
  /** Origin of the connect host; the path is this client's own. */
  readonly endpoint: string;
  /** Injected by suites; a dispatcher built from the environment otherwise. */
  readonly dispatcher?: Dispatcher;
}

export class ConnectLicenseClient {
  private readonly http: ConnectHttp;

  constructor(options: ConnectLicenseClientOptions) {
    this.http = new ConnectHttp(options);
  }

  async close(): Promise<void> {
    await this.http.close();
  }

  /**
   * Redeems an activation code for the license it describes.
   *
   * The code goes in the credential's token slot because it is the whole
   * credential for this one call, exactly as the license token is for a sync.
   */
  async activate({
    code,
    instanceId,
    signal,
  }: {
    code: string;
    instanceId: string;
    signal?: AbortSignal;
  }): Promise<ActivationAnswer> {
    return this.http.call({
      path: "/v1/license/activate",
      method: "POST",
      credential: { token: code, instanceId },
      body: {},
      schema: activateAnswerSchema,
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
    const answer = await this.http.call({
      path: "/v1/license/sync",
      method: "POST",
      credential,
      body: {
        version,
        seats: { members: seats.members, liteMembers: seats.liteMembers },
      },
      schema: syncAnswerSchema,
      ...(signal ? { signal } : {}),
    });
    return {
      lease: answer.lease,
      ...(answer.license ? { license: answer.license } : {}),
    };
  }
}

let shared: { endpoint: string; client: ConnectLicenseClient } | undefined;

/**
 * The process's client for one connect host.
 *
 * One instance because the dispatcher is a keep-alive pool; a second would
 * open a second set of connections to the same host.
 */
export function getConnectLicenseClient(
  endpoint: string,
): ConnectLicenseClient {
  if (shared?.endpoint !== endpoint) {
    void shared?.client.close().catch(() => undefined);
    shared = { endpoint, client: new ConnectLicenseClient({ endpoint }) };
  }
  return shared.client;
}

/** Drops the shared client. For suites, and for a clean shutdown. */
export async function resetConnectLicenseClient(): Promise<void> {
  const previous = shared;
  shared = undefined;
  await previous?.client.close();
}
