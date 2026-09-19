/**
 * What an organization's Connect settings read and write (ADR-139).
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
import {
  ConnectLicenseRequiredError,
  ConnectServiceNotEntitledError,
} from "../errors";
import { type ConnectConfig, readConnectConfig } from "./connectConfig";
import { resolveConnectCredential } from "./connectCredential";
import { ConnectDisabledError } from "./connectErrors";
import {
  type ConnectCredential,
  type ConnectGatewayClient,
  type ConnectUsage,
  getConnectGatewayClient,
} from "./connectGatewayClient";

/** What a refused read came back as, for the page to render. */
export interface ConnectRefusal {
  readonly code: string;
  readonly meta?: unknown;
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
    };

export interface ConnectSettingsDependencies {
  readonly prisma: PrismaClient;
  /** Injected by suites; read from the deployment configuration otherwise. */
  readonly config?: ConnectConfig;
  /** Injected by suites; the process's shared client otherwise. */
  readonly client?: ConnectGatewayClient;
}

export class ConnectSettingsService {
  constructor(private readonly deps: ConnectSettingsDependencies) {}

  async status(organizationId: string): Promise<ConnectStatus> {
    const config = this.config();
    if (!config.enabled) return { deployment: "off" };

    const [credential, enabledServices] = await Promise.all([
      this.credentialOf(organizationId),
      this.enabledServicesOf(organizationId),
    ]);
    const base = {
      deployment: "on",
      gatewayHost: new URL(config.gatewayEndpoint).host,
      enabledServices,
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

    const current = await this.enabledServicesOf(organizationId);
    const next = enabled
      ? [...new Set([...current, service])]
      : current.filter((name) => name !== service);

    await this.deps.prisma.organization.update({
      where: { id: organizationId },
      data: { connectServices: next },
    });
    return { enabledServices: next };
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
    if (!config.enabled) throw new ConnectDisabledError();

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

  private async enabledServicesOf(organizationId: string): Promise<string[]> {
    const organization = await this.deps.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { connectServices: true },
    });
    return organization?.connectServices ?? [];
  }
}
