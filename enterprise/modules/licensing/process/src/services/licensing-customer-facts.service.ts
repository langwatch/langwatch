import type { EventingCommands } from "@langwatch/eventing";
import { type Instant, nowInstant } from "@langwatch/time";

import type { LicensingCustomerPipeline } from "../eventing/licensing-customer.pipeline.ts";
import type { StoredLicense } from "../repositories/organization-license.repository.ts";
import { fingerprintOfLicenseKey } from "../rules/license-key.rules.ts";

/** Records licensing's facts about its customers on its own pipeline (R42). */
export class LicensingCustomerFactsService {
  #commands: EventingCommands<LicensingCustomerPipeline> | undefined;

  static create(): LicensingCustomerFactsService {
    return new LicensingCustomerFactsService();
  }

  private constructor() {}

  /** Binds the licensing_customer pipeline's own senders. */
  connect(commands: EventingCommands<LicensingCustomerPipeline>): void {
    this.#commands = commands;
  }

  /** Organization creates and marks the customer's row under this id, seconds later. */
  async selfHostedCustomerLicensed({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<void> {
    await this.commands().recordSelfHostedCustomerLicensed.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      name,
    });
  }

  /** Organization keeps the refusal list on its own row from this fact, seconds later. */
  async connectServiceSwitched({
    organizationId,
    service,
    enabled,
  }: {
    organizationId: string;
    service: string;
    enabled: boolean;
  }): Promise<void> {
    await this.commands().recordConnectServiceSwitched.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      service,
      enabled,
    });
  }

  /** Organization writes when the sync landed, or the code it failed on, from this fact. */
  async licenseSyncFinished({
    organizationId,
    at,
    error,
  }: {
    organizationId: string;
    at: Instant;
    error: string | null;
  }): Promise<void> {
    await this.commands().recordLicenseSyncFinished.send({
      tenantId: organizationId,
      occurredAt: at.epochMilliseconds,
      organizationId,
      error,
    });
  }

  /** Names the key by its fingerprint only; organization reads the key from licensing's row. */
  async licenseStored({
    organizationId,
    license,
  }: {
    organizationId: string;
    license: StoredLicense;
  }): Promise<void> {
    await this.commands().recordLicenseStored.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      licenseKeyFingerprint: fingerprintOfLicenseKey(license.licenseKey),
      expiresAt: license.expiresAt.epochMilliseconds,
      validatedAt: license.validatedAt?.epochMilliseconds ?? null,
    });
  }

  /** Organization clears its licence columns from this fact. */
  async licenseCleared({ organizationId }: { organizationId: string }): Promise<void> {
    await this.commands().recordLicenseCleared.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
    });
  }

  /** Gateway revokes the key from this fact, seconds later; a revoked key is left alone. */
  async managedKeyRetired({
    virtualKeyId,
    organizationId,
    actorId,
  }: {
    virtualKeyId: string;
    organizationId: string;
    actorId: string;
  }): Promise<void> {
    await this.commands().recordManagedKeyRetired.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      virtualKeyId,
      actorId,
    });
  }

  /** Gateway tells every gateway to resolve the key's licence again from this fact. */
  async managedKeyInvalidated({
    virtualKeyId,
    organizationId,
  }: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<void> {
    await this.commands().recordManagedKeyInvalidated.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      virtualKeyId,
    });
  }

  /** Gateway rewrites the key's licence from this fact; names the token by its registry hash. */
  async managedKeyLicenseSet({
    virtualKeyId,
    organizationId,
    tokenHash,
    instanceId,
    expiresAt,
  }: {
    virtualKeyId: string;
    organizationId: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant;
  }): Promise<void> {
    await this.commands().recordManagedKeyLicenseSet.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      virtualKeyId,
      tokenHash,
      instanceId,
      expiresAt: expiresAt.epochMilliseconds,
    });
  }

  /** Gateway replaces the key's platform services from this fact; empty serves none. */
  async managedKeyServicesSet({
    virtualKeyId,
    organizationId,
    services,
  }: {
    virtualKeyId: string;
    organizationId: string;
    services: readonly string[];
  }): Promise<void> {
    await this.commands().recordManagedKeyServicesSet.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      virtualKeyId,
      services: [...services],
    });
  }

  /** Gateway provisions the licence's managed key from this fact; names the token by hash only. */
  async connectCredentialIssued({
    organizationId,
    licenseId,
    issuedLicenseId,
    instanceId,
    tokenHash,
    expiresAt,
    services,
  }: {
    organizationId: string;
    licenseId: string;
    issuedLicenseId: string;
    instanceId: string;
    tokenHash: string;
    expiresAt: Instant;
    services: readonly string[];
  }): Promise<void> {
    await this.commands().recordConnectCredentialIssued.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      licenseId,
      issuedLicenseId,
      instanceId,
      tokenHash,
      expiresAt: expiresAt.epochMilliseconds,
      services: [...services],
    });
  }

  /** Connect syncs the organization's contract budget from this fact, seconds later. */
  async contractTermsChanged({
    organizationId,
    operatorId,
  }: {
    organizationId: string;
    operatorId: string;
  }): Promise<void> {
    await this.commands().recordContractTermsChanged.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      operatorId,
    });
  }

  private commands(): EventingCommands<LicensingCustomerPipeline> {
    if (!this.#commands) {
      throw new Error("licensing_customer pipeline senders are not connected yet");
    }
    return this.#commands;
  }
}
