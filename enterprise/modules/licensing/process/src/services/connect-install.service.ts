/**
 * The install end of Connect (ADR-156): the credential derived from the license
 * an organization holds, and what Settings, Connect reads and writes.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import {
  type ConnectClassifyAnswer,
  type ConnectCredential,
  type ConnectDeploymentView,
  type ConnectService,
  type ConnectStatus,
  type ConnectSyncView,
  ConnectDisabledError,
  ConnectLicenseRequiredError,
  ConnectServiceNotEntitledError,
} from "@langwatch/enterprise-licensing-contract";
import { HandledError } from "@langwatch/handled-error";

import type { ConnectUpstreamSlot, LicenseCryptography } from "../app/licensing.members.ts";
import type { ConnectGatewayChannel } from "../channels/connect-gateway.channel.ts";
import type {
  ConnectOrganizationRecord,
  ConnectOrganizationRepository,
} from "../repositories/connect-organization.repository.ts";
import {
  connectServicesDisabledAfter,
  connectServicesNamedBy,
  enabledConnectServices,
} from "../rules/connect-entitlement.rules.ts";
import type { InstanceIdentityService } from "./instance-identity.service.ts";

/** What a deployment decided about Connect, before any license has its say. */
export interface ConnectDeployment {
  /**
   * False only where an operator switched Connect off. True is not a claim that
   * anything is reachable: the license decides that.
   */
  readonly permitted: boolean;
  readonly gatewayEndpoint: string;
  readonly licenseEndpoint: string;
}

export interface ConnectInstallServiceDependencies {
  readonly organizations: ConnectOrganizationRepository;
  readonly identity: InstanceIdentityService;
  readonly cryptography: LicenseCryptography;
  readonly deployment: ConnectDeployment;
  /** Composed only where Connect is permitted; absent means no outbound call. */
  readonly gateway?: ConnectGatewayChannel;
  /** The key this whole deployment is licensed by, where one is set. */
  readonly instanceLicenseKey: () => string | undefined;
  /** The key licenses are verified against, where the deployment names one. */
  readonly publicKey?: string;
  /** The install gateway's hosted provider slot, where one is composed. */
  readonly upstream?: ConnectUpstreamSlot;
}

/** The hosted service the install's gateway slot serves. */
const MANAGED_MODELS = "managed_models";

export class ConnectInstallService {
  static create(deps: ConnectInstallServiceDependencies): ConnectInstallService {
    return new ConnectInstallService(deps);
  }

  private constructor(private readonly deps: ConnectInstallServiceDependencies) {}

  /**
   * The credential this organization calls LangWatch with; empty where it holds
   * no license, where the license is not a license, or where Connect is off.
   */
  async findCredential(organizationId: string): Promise<ConnectCredential[]> {
    if (!this.deps.deployment.permitted) return [];

    const organization = await this.deps.organizations.findById(organizationId);
    const licenseKey = this.licenseKeyOf(organization);
    if (!licenseKey) return [];

    const token = this.tokenOf(licenseKey);
    if (!token) return [];

    return [{ token, instanceId: await this.deps.identity.getInstanceId() }];
  }

  /** The hosted services this organization's license names. */
  async findEntitledServices(organizationId: string): Promise<ConnectService[]> {
    if (!this.deps.deployment.permitted) return [];
    const organization = await this.deps.organizations.findById(organizationId);
    return this.entitledOf(organization);
  }

  /** The entitled services, less the ones an administrator switched off. */
  async findEnabledServices(organizationId: string): Promise<ConnectService[]> {
    if (!this.deps.deployment.permitted) return [];
    const organization = await this.deps.organizations.findById(organizationId);
    return enabledConnectServices({
      entitled: this.entitledOf(organization),
      disabled: organization?.servicesDisabled ?? [],
    });
  }

  /** Whether one hosted service is both entitled and switched on. */
  async isServiceEnabled({
    organizationId,
    service,
  }: {
    organizationId: string;
    service: ConnectService;
  }): Promise<boolean> {
    const enabled = await this.findEnabledServices(organizationId);
    return enabled.includes(service);
  }

  /**
   * What the deployment decided, and whether any license on the install names a
   * hosted service: the usage report goes to the connect host only then.
   */
  async getDeployment(): Promise<ConnectDeploymentView> {
    const { deployment } = this.deps;
    return {
      permitted: deployment.permitted,
      connected: await this.isInstallConnected(),
      licenseEndpoint: deployment.licenseEndpoint,
      gatewayEndpoint: deployment.gatewayEndpoint,
    };
  }

  /** Every organization holding a license, which the daily sync passes over. */
  findLicensedOrganizationIds(): Promise<string[]> {
    return this.deps.organizations.findLicensedOrganizationIds();
  }

  private async isInstallConnected(): Promise<boolean> {
    if (!this.deps.deployment.permitted) return false;
    for (const organizationId of await this.deps.organizations.findLicensedOrganizationIds()) {
      const organization = await this.deps.organizations.findById(organizationId);
      if (this.entitledOf(organization).length > 0) return true;
    }
    return false;
  }

  /** What Settings, Connect renders for this organization. */
  async getStatus(organizationId: string): Promise<ConnectStatus> {
    const { deployment } = this.deps;
    if (!deployment.permitted) return { deployment: "off" };

    const organization = await this.deps.organizations.findById(organizationId);
    const entitled = this.entitledOf(organization);
    const base = {
      deployment: "on",
      gatewayHost: new URL(deployment.gatewayEndpoint).host,
      enabledServices: enabledConnectServices({
        entitled,
        disabled: organization?.servicesDisabled ?? [],
      }),
      sync: syncOf(organization),
    } as const;

    const [credential] = await this.findCredential(organizationId);
    if (!credential) {
      return { ...base, licensed: false, entitledServices: null, usage: null, refusal: null };
    }

    try {
      const usage = await this.gateway().usage({ credential });
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
   * Switches one hosted service on or off for this organization. Switching one
   * on asks the host first, because the license the install holds may name a
   * service the registry has since revoked.
   */
  async setService({
    organizationId,
    service,
    enabled,
  }: {
    organizationId: string;
    service: string;
    enabled: boolean;
  }): Promise<{ enabledServices: ConnectService[] }> {
    const credential = await this.requireCredential(organizationId);

    if (enabled) {
      const usage = await this.gateway().usage({ credential });
      if (!usage.services.includes(service)) throw new ConnectServiceNotEntitledError(service);
    }

    const organization = await this.deps.organizations.findById(organizationId);
    const servicesDisabled = connectServicesDisabledAfter({
      current: organization?.servicesDisabled ?? [],
      service,
      enabled,
    });
    await this.deps.organizations.setServicesDisabled({ organizationId, servicesDisabled });
    await this.publishUpstream(organizationId);

    return {
      enabledServices: enabledConnectServices({
        entitled: this.entitledOf(organization),
        disabled: servicesDisabled,
      }),
    };
  }

  /**
   * Judges one text on LangWatch. The judgement leaves the install only for an
   * organization whose license names the service and whose administrator has
   * not switched it off; both are checked by the caller that holds the judge.
   */
  async classify({
    organizationId,
    text,
    questions,
  }: {
    organizationId: string;
    text: string;
    questions: readonly unknown[];
  }): Promise<ConnectClassifyAnswer> {
    const credential = await this.requireCredential(organizationId);
    return this.gateway().classify({ credential, text, questions });
  }

  /** Moves the customer's own hosted usage cap, up to the contract maximum. */
  async setCap({
    organizationId,
    capUsd,
  }: {
    organizationId: string;
    capUsd: number;
  }): Promise<{ capUsd: number; maximumCapUsd: number }> {
    const credential = await this.requireCredential(organizationId);
    return this.gateway().setBudget({ credential, capUsd });
  }

  /**
   * Writes the gateway's hosted provider slot while Connect is on, managed models
   * are entitled and switched on, and a license yields a token; clears it otherwise.
   */
  async publishUpstream(organizationId: string): Promise<void> {
    const { upstream } = this.deps;
    if (!upstream) return;
    const [credential] = await this.findCredential(organizationId);
    const enabled = await this.isServiceEnabled({ organizationId, service: MANAGED_MODELS });
    if (!credential || !enabled) {
      await upstream.clear({ organizationId });
      return;
    }
    await upstream.set({
      organizationId,
      baseUrl: this.deps.deployment.gatewayEndpoint,
      token: credential.token,
      instanceId: credential.instanceId,
    });
  }

  /** The credential a change needs, or the reason it cannot be made. */
  private async requireCredential(organizationId: string): Promise<ConnectCredential> {
    if (!this.deps.deployment.permitted) throw new ConnectDisabledError();
    const [credential] = await this.findCredential(organizationId);
    if (!credential) throw new ConnectLicenseRequiredError();
    return credential;
  }

  private gateway(): ConnectGatewayChannel {
    const { gateway } = this.deps;
    if (!gateway) throw new ConnectDisabledError();
    return gateway;
  }

  /**
   * Falls back to the instance-wide license, so a deployment licensed through
   * one key is entitled on every organization it carries.
   */
  private licenseKeyOf(organization: ConnectOrganizationRecord | null): string | undefined {
    return organization?.license ?? this.deps.instanceLicenseKey() ?? void 0;
  }

  private entitledOf(organization: ConnectOrganizationRecord | null): ConnectService[] {
    const licenseKey = this.licenseKeyOf(organization);
    if (!licenseKey) return [];

    const result = this.deps.cryptography.validateLicense({
      licenseKey,
      ...(this.deps.publicKey ? { publicKey: this.deps.publicKey } : {}),
    });
    if (!result.valid) return [];

    return connectServicesNamedBy(result.licenseData.connectServices);
  }

  /** A pasted key that is not a license yields no credential, not a crash. */
  private tokenOf(licenseKey: string): string | undefined {
    try {
      return this.deps.cryptography.getLicenseToken(licenseKey);
    } catch {
      return void 0;
    }
  }
}

/** Where the daily sync stands, for the page to say so. */
function syncOf(organization: ConnectOrganizationRecord | null): ConnectSyncView {
  return {
    lastSyncAt: organization?.lastSyncAt?.toString() ?? null,
    lastError: organization?.lastSyncError ? { code: organization.lastSyncError } : null,
  };
}
