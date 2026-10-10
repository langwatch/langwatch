/**
 * The managed gateway key of a self-hosted license (ADR-156 §3): an ordinary
 * virtual key with `purpose: CONNECT`, so budgets, spend, the change feed and
 * revocation work as for any key. Its secret is dropped as it is minted.
 */

import { SYSTEM_ACTORS } from "@langwatch/authorization";
import type { ConnectCredentialIssuedEventData } from "@langwatch/enterprise-licensing-contract";
import type {
  GatewayManagedKeyProvisionedEventData,
  GatewayVirtualKeyScope,
} from "@langwatch/gateway-contract";
import { type Instant, nowInstant, Temporal } from "@langwatch/time";

/** The key writes this service makes, narrower than the full key capability. */
export type ConnectManagedKeyWrites = Readonly<{
  create(input: {
    organizationId: string;
    name: string;
    description?: string | null;
    principalUserId?: string | null;
    scopes: GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
    actorUserId: string;
    purpose?: "USER" | "LANGY" | "CONNECT";
  }): Promise<{ virtualKey: { id: string } }>;
  revokeManagedInternal(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<void>;
  invalidateManagedInternal(input: { id: string; organizationId: string }): Promise<void>;
  setConnectServicesInternal(input: {
    id: string;
    organizationId: string;
    services: readonly string[];
  }): Promise<void>;
  setLicenseFactsInternal(input: {
    id: string;
    organizationId: string;
    licenseId?: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant | null;
  }): Promise<void>;
  /** Unrevoked CONNECT keys of one licence in the organization, oldest first. */
  findConnectKeyIdsForLicenseInternal(input: {
    organizationId: string;
    licenseId: string;
  }): Promise<string[]>;
}>;

/** The sender the provisioned fact goes out through, bound once the pipeline connects. */
export type ManagedKeyProvisionedSender = Readonly<{
  recordManagedKeyProvisioned: {
    send(data: GatewayManagedKeyProvisionedEventData): Promise<unknown>;
  };
}>;

/**
 * Where hosted-service spend lands: the organization's hidden governance
 * project, which organization-scoped keys already use. Named rather than
 * worked out, or an organization with projects of its own reads as ambiguous.
 */
export type ConnectManagedKeyHome = Readonly<{
  ensureInternal(input: {
    organizationId: string;
    kind: "internal_governance";
  }): Promise<{ id: string }>;
}>;

export class ConnectManagedKeyService {
  #commands: ManagedKeyProvisionedSender | undefined;

  private constructor(
    private readonly virtualKeys: ConnectManagedKeyWrites,
    private readonly home: ConnectManagedKeyHome,
  ) {}

  static create(input: {
    virtualKeys: ConnectManagedKeyWrites;
    home: ConnectManagedKeyHome;
  }): ConnectManagedKeyService {
    return new ConnectManagedKeyService(input.virtualKeys, input.home);
  }

  async provision(input: {
    organizationId: string;
    licenseId: string;
    actorUserId: string;
  }): Promise<{ id: string }> {
    const home = await this.home.ensureInternal({
      organizationId: input.organizationId,
      kind: "internal_governance",
    });
    const { virtualKey } = await this.virtualKeys.create({
      organizationId: input.organizationId,
      name: `Connect ${input.licenseId}`,
      description: "Managed key for the hosted services of a self-hosted license.",
      principalUserId: null,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: input.organizationId }],
      traceProjectId: home.id,
      actorUserId: input.actorUserId,
      purpose: "CONNECT",
    });

    return { id: virtualKey.id };
  }

  /** Binds the gateway_connect_managed_key pipeline's own sender. */
  connect(commands: ManagedKeyProvisionedSender): void {
    this.#commands = commands;
  }

  /**
   * One key per licence: finds it or mints it, writes its services and licence, and only then
   * records the provisioned fact, so licensing attaches a key that already resolves (C3B-ORDER).
   */
  async provisionForLicense(issued: ConnectCredentialIssuedEventData): Promise<void> {
    const { organizationId, licenseId } = issued;
    const [found] = await this.virtualKeys.findConnectKeyIdsForLicenseInternal({
      organizationId,
      licenseId,
    });
    const virtualKeyId =
      found ??
      (
        await this.provision({
          organizationId,
          licenseId,
          actorUserId: SYSTEM_ACTORS.connectLicense,
        })
      ).id;
    await this.setConnectServices({ virtualKeyId, organizationId, services: issued.services });
    await this.virtualKeys.setLicenseFactsInternal({
      id: virtualKeyId,
      organizationId,
      licenseId,
      tokenHash: issued.tokenHash,
      instanceId: issued.instanceId,
      expiresAt: Temporal.Instant.fromEpochMilliseconds(issued.expiresAt),
    });
    await this.provisionedSender().recordManagedKeyProvisioned.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      licenseId,
      issuedLicenseId: issued.issuedLicenseId,
      virtualKeyId,
    });
  }

  /** Ends the key for good. Safe to repeat. */
  async retire(input: {
    virtualKeyId: string;
    organizationId: string;
    actorId: string;
  }): Promise<void> {
    await this.virtualKeys.revokeManagedInternal({
      id: input.virtualKeyId,
      organizationId: input.organizationId,
      actorUserId: input.actorId,
    });
  }

  /** Records the platform services the license lets its key serve; empty serves none. */
  async setConnectServices(input: {
    virtualKeyId: string;
    organizationId: string;
    services: readonly string[];
  }): Promise<void> {
    await this.virtualKeys.setConnectServicesInternal({
      id: input.virtualKeyId,
      organizationId: input.organizationId,
      services: input.services,
    });
  }

  /** Records the license the key serves, as licensing last wrote it. Safe to repeat. */
  async setLicense(input: {
    virtualKeyId: string;
    organizationId: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant | null;
  }): Promise<void> {
    await this.virtualKeys.setLicenseFactsInternal({
      id: input.virtualKeyId,
      organizationId: input.organizationId,
      tokenHash: input.tokenHash,
      instanceId: input.instanceId,
      expiresAt: input.expiresAt,
    });
  }

  /** Makes every gateway resolve the license again on its next call. */
  async invalidate(input: { virtualKeyId: string; organizationId: string }): Promise<void> {
    await this.virtualKeys.invalidateManagedInternal({
      id: input.virtualKeyId,
      organizationId: input.organizationId,
    });
  }

  private provisionedSender(): ManagedKeyProvisionedSender {
    if (!this.#commands) {
      throw new Error("gateway_connect_managed_key pipeline senders are not connected yet");
    }
    return this.#commands;
  }
}
