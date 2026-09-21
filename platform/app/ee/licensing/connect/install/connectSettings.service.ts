/**
 * What an organization's Connect settings read and write (ADR-141).
 *
 * Reading never throws on a refusal from the host. An administrator opening
 * these settings to find out why hosted judging stopped is the reader who most
 * needs the answer, and a query that fails leaves the page with nothing to show
 * but a generic error, so the refusal is carried back as data and the page
 * renders the copy for its code. Writing does throw: a refused change is a
 * change that did not happen, and the form is the right place to say so.
 *
 * @see ../../../../src/server/api/routers/connect.ts
 * @see ../../../../../specs/self-hosting/connected-services/connect-settings.feature
 */

import { HandledError } from "@langwatch/handled-error";

import type { PrismaClient } from "~/generated/prisma/client";
import { PUBLIC_KEY } from "../../constants";
import {
  ConnectLicenseRequiredError,
  ConnectServiceNotEntitledError,
} from "../errors";
import type { LeaseState } from "../lease";
import { type ConnectConfig, readConnectConfig } from "./connectConfig";
import { resolveConnectCredential } from "./connectCredential";
import { licenseConnectServices } from "./connectEntitlement";
import { ConnectDisabledError } from "./connectErrors";
import {
  type ConnectGatewayClient,
  type ConnectUsage,
  getConnectGatewayClient,
} from "./connectGatewayClient";
import type { ConnectCredential } from "./connectTransport";
import { readInstalledLease } from "./installedLease";
import { readInstanceId } from "./instanceIdentity";

/** What a refused read came back as, for the page to render. */
export interface ConnectRefusal {
  readonly code: string;
  readonly meta?: unknown;
}

/** The lease the last sync left, as the page reads it. */
export interface ConnectLeaseView {
  readonly seatOverageAllowance: number;
  readonly warnAfter: string;
  readonly validUntil: string;
  readonly state: LeaseState;
}

/** Where the daily license sync stands (ADR-141, section 6). */
export interface ConnectSyncView {
  readonly lastSyncAt: string | null;
  readonly lastError: { readonly code: string } | null;
  readonly lease: ConnectLeaseView | null;
}

export type ConnectStatus =
  | { readonly deployment: "off" }
  | {
      readonly deployment: "on";
      readonly gatewayHost: string;
      readonly licensed: boolean;
      readonly enabledServices: string[];
      readonly entitledServices: string[] | null;
      readonly usage: ConnectUsage | null;
      readonly refusal: ConnectRefusal | null;
      readonly sync: ConnectSyncView;
    };

export interface ConnectSettingsDependencies {
  readonly prisma: PrismaClient;
  /** Injected by suites; read from the deployment configuration otherwise. */
  readonly config?: ConnectConfig;
  /** Injected by suites; the process's shared client otherwise. */
  readonly client?: ConnectGatewayClient;
  /** Injected by suites; the key the license handler verifies with otherwise. */
  readonly publicKey?: string;
  /** Injected by suites; the wall clock otherwise. */
  readonly now?: () => Date;
}

export class ConnectSettingsService {
  constructor(private readonly deps: ConnectSettingsDependencies) {}

  async status(organizationId: string): Promise<ConnectStatus> {
    const config = this.config();
    if (!config.permitted) return { deployment: "off" };

    const [credential, organization] = await Promise.all([
      this.credentialOf(organizationId),
      this.organizationOf(organizationId),
    ]);
    const entitled = licenseConnectServices({
      licenseKey: organization?.license ?? null,
      publicKey: this.deps.publicKey ?? PUBLIC_KEY,
      ...(this.deps.now ? { now: this.deps.now() } : {}),
    });
    const disabled = new Set(organization?.connectServicesDisabled ?? []);
    const base = {
      deployment: "on",
      gatewayHost: new URL(config.gatewayEndpoint).host,
      enabledServices: entitled.filter((service) => !disabled.has(service)),
      sync: await this.syncOf(organization),
    } as const;

    if (!credential) {
      return {
        ...base,
        licensed: false,
        entitledServices: null,
        usage: null,
        refusal: null,
      };
    }

    try {
      const usage = await this.client(config.gatewayEndpoint).usage({
        credential,
      });
      return {
        ...base,
        licensed: true,
        entitledServices: usage.services,
        usage,
        refusal: null,
      };
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      return {
        ...base,
        licensed: true,
        entitledServices: null,
        usage: null,
        refusal: { code: error.code, meta: error.meta },
      };
    }
  }

  async setService({
    organizationId,
    service,
    enabled,
  }: {
    organizationId: string;
    service: string;
    enabled: boolean;
  }): Promise<{ enabledServices: string[] }> {
    const { client, credential } = await this.requireConnection(organizationId);

    if (enabled) {
      const usage = await client.usage({ credential });
      if (!usage.services.includes(service)) {
        throw new ConnectServiceNotEntitledError(service);
      }
    }

    // The column records refusals, so switching a service on removes a row
    // rather than adding one and an entitled service needs no row at all.
    const organization = await this.organizationOf(organizationId);
    const current = organization?.connectServicesDisabled ?? [];
    const nextDisabled = enabled
      ? current.filter((name) => name !== service)
      : [...new Set([...current, service])];

    await this.deps.prisma.organization.update({
      where: { id: organizationId },
      data: { connectServicesDisabled: nextDisabled },
    });

    const entitled = licenseConnectServices({
      licenseKey: organization?.license ?? null,
      publicKey: this.deps.publicKey ?? PUBLIC_KEY,
      ...(this.deps.now ? { now: this.deps.now() } : {}),
    });
    const refused = new Set(nextDisabled);
    return {
      enabledServices: entitled.filter((name) => !refused.has(name)),
    };
  }

  async setCap({
    organizationId,
    capUsd,
  }: {
    organizationId: string;
    capUsd: number;
  }): Promise<{ capUsd: number; maximumCapUsd: number }> {
    const { client, credential } = await this.requireConnection(organizationId);
    return await client.setBudget({ credential, capUsd });
  }

  /** The host and the credential a change needs, or why it cannot be made. */
  private async requireConnection(organizationId: string): Promise<{
    client: ConnectGatewayClient;
    credential: ConnectCredential;
  }> {
    const config = this.config();
    if (!config.permitted) throw new ConnectDisabledError();

    const credential = await this.credentialOf(organizationId);
    if (!credential) throw new ConnectLicenseRequiredError();

    return { client: this.client(config.gatewayEndpoint), credential };
  }

  private config(): ConnectConfig {
    return this.deps.config ?? readConnectConfig();
  }

  private client(endpoint: string): ConnectGatewayClient {
    return this.deps.client ?? getConnectGatewayClient(endpoint);
  }

  private async credentialOf(
    organizationId: string,
  ): Promise<ConnectCredential | null> {
    return await resolveConnectCredential({
      prisma: this.deps.prisma,
      organizationId,
    });
  }

  private async organizationOf(
    organizationId: string,
  ): Promise<ConnectOrganizationRow | null> {
    return await this.deps.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        connectServicesDisabled: true,
        license: true,
        connectLease: true,
        connectLastSyncAt: true,
        connectLastSyncError: true,
      },
    });
  }

  /**
   * Where the daily sync stands, for the page to say so.
   *
   * The lease is read through the same check the plan reads it through, so
   * what the page shows and what the seat guard enforces can not disagree. An
   * expired lease is still reported, because "the allowance was withdrawn on
   * this day" is the answer an admin is looking for.
   */
  private async syncOf(
    organization: ConnectOrganizationRow | null,
  ): Promise<ConnectSyncView> {
    const licenseKey = organization?.license ?? null;
    // Read, never mint: opening a settings page is not a reason to give this
    // install an identity it has not needed yet.
    const instanceId = licenseKey
      ? await readInstanceId(this.deps.prisma)
      : null;
    const installed =
      licenseKey && instanceId
        ? readInstalledLease({
            licenseKey,
            lease: organization?.connectLease,
            instanceId,
            publicKey: this.deps.publicKey ?? PUBLIC_KEY,
            now: this.deps.now?.() ?? new Date(),
          })
        : null;

    return {
      lastSyncAt: organization?.connectLastSyncAt?.toISOString() ?? null,
      lastError: organization?.connectLastSyncError
        ? { code: organization.connectLastSyncError }
        : null,
      lease: installed
        ? {
            seatOverageAllowance: installed.payload.seatOverageAllowance,
            warnAfter: installed.payload.warnAfter,
            validUntil: installed.payload.validUntil,
            state: installed.state,
          }
        : null,
    };
  }
}

interface ConnectOrganizationRow {
  connectServicesDisabled: string[];
  license: string | null;
  connectLease: unknown;
  connectLastSyncAt: Date | null;
  connectLastSyncError: string | null;
}
