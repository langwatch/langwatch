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

import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { PUBLIC_KEY } from "../../constants";
import {
  ConnectLicenseRequiredError,
  ConnectServiceNotEntitledError,
} from "../errors";
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

/** What a refused read came back as, for the page to render. */
export interface ConnectRefusal {
  readonly code: string;
  readonly meta?: unknown;
}

/** Where the daily license sync stands (ADR-141, section 6). */
export interface ConnectSyncView {
  readonly lastSyncAt: string | null;
  readonly lastError: { readonly code: string } | null;
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

  /**
   * What the page shows. The gateway is asked for usage only once the
   * organization has switched a service on: until then nothing is sent to
   * LangWatch, opening the page included, and what the license names is read
   * from the license this install already holds.
   */
  async status(organizationId: string): Promise<ConnectStatus> {
    const config = this.config();
    if (!config.permitted) return { deployment: "off" };

    const [credential, organization] = await Promise.all([
      this.credentialOf(organizationId),
      this.organizationOf(organizationId),
    ]);
    const entitled = this.entitledOf(organization);
    const enabledServices = optedIn({
      entitled,
      enabled: organization?.connectServicesEnabled ?? [],
    });
    const base = {
      deployment: "on",
      gatewayHost: new URL(config.gatewayEndpoint).host,
      enabledServices,
      sync: syncOf(organization),
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

    if (enabledServices.length === 0) {
      return {
        ...base,
        licensed: true,
        entitledServices: entitled,
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

  /**
   * Switches one hosted service on or off for the organization. Switching on
   * asks the gateway whether the license is entitled to it first, which is
   * the admin's explicit decision to reach LangWatch. Switching off makes no
   * call.
   */
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

    const organization = await this.organizationOf(organizationId);
    const current = organization?.connectServicesEnabled ?? [];
    const nextEnabled = enabled
      ? [...new Set([...current, service])]
      : current.filter((name) => name !== service);

    await this.deps.prisma.organization.update({
      where: { id: organizationId },
      data: { connectServicesEnabled: nextEnabled },
    });

    return {
      enabledServices: optedIn({
        entitled: this.entitledOf(organization),
        enabled: nextEnabled,
      }),
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

  /** What the license this install holds names, read without a network call. */
  private entitledOf(organization: ConnectOrganizationRow | null): string[] {
    return licenseConnectServices({
      licenseKey: organization?.license ?? env.LANGWATCH_LICENSE_KEY ?? null,
      publicKey: this.deps.publicKey ?? PUBLIC_KEY,
      ...(this.deps.now ? { now: this.deps.now() } : {}),
    });
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
        connectServicesEnabled: true,
        license: true,
        connectLastSyncAt: true,
        connectLastSyncError: true,
      },
    });
  }
}

interface ConnectOrganizationRow {
  connectServicesEnabled: string[];
  license: string | null;
  connectLastSyncAt: Date | null;
  connectLastSyncError: string | null;
}

/** The entitled services an administrator switched on, in license order. */
function optedIn({
  entitled,
  enabled,
}: {
  entitled: string[];
  enabled: string[];
}): string[] {
  const on = new Set(enabled);
  return entitled.filter((service) => on.has(service));
}

/** Where the daily sync stands, for the page to say so. */
function syncOf(organization: ConnectOrganizationRow | null): ConnectSyncView {
  return {
    lastSyncAt: organization?.connectLastSyncAt?.toISOString() ?? null,
    lastError: organization?.connectLastSyncError
      ? { code: organization.connectLastSyncError }
      : null,
  };
}
