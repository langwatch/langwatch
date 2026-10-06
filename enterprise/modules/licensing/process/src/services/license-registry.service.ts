/**
 * The license registry (ADR-156): the record of every license LangWatch issued.
 * Every issue path goes through here, so a license never exists without its
 * row, and the signing key comes from a server secret rather than a caller.
 */

import type {
  LicenseCryptography,
  LicenseGenerationService,
} from "@langwatch/enterprise-license-signing";
import {
  entitledConnectServices,
  type ConnectedSeats,
  type IssueLicenseInput as ContractIssueLicenseInput,
  IssuedLicenseNotActiveError,
  IssuedLicenseNotFoundError,
  LicenseKeyInvalidError,
  OrganizationNotFoundError,
  type IssuedLicenseCustomerRecord,
  type IssuedLicensePage,
  type IssuedLicenseSource,
  type IssuedLicenseView,
  type LicenseCustomer,
  type LicenseSeatChange,
  type LicenseTermsInput,
  type SeatChangeResult,
  type SignedIssuedLicense,
  type ConnectService,
} from "@langwatch/enterprise-licensing-contract";
import { licenseSeats } from "@langwatch/plans";
import { Temporal, toDate, type Instant } from "@langwatch/time";

import type {
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import { resolveLicenseTerms } from "../rules/issued-license-row.rules.ts";
import { issuedLicenseView, statusOfIssuedLicense } from "../rules/issued-license.rules.ts";
import type { ContractBudgets } from "./contract-budget.service.ts";
import { IssuedLicenseWriterService } from "./issued-license-writer.service.ts";

interface LicenseRegistryOptions {
  repository: IssuedLicenseRepository;
  organizations: LicenseCustomers;
  managedKeys: ConnectManagedKeys;
  contractBudgets: ContractBudgets;
  cryptography: LicenseCryptography;
  generation: LicenseGenerationService;
  /** The signing key from the server secret, or undefined when none is set. */
  signingKey: () => string | undefined;
  now: () => Instant;
}

/** What `issue` decides, with the term as an instant rather than a wire string. */
type IssueLicenseTerms = Omit<ContractIssueLicenseInput, "expiresAt"> & {
  expiresAt: Instant;
};

export class LicenseRegistryService {
  static create(options: LicenseRegistryOptions): LicenseRegistryService {
    return new LicenseRegistryService(options);
  }

  private readonly writer: IssuedLicenseWriterService;

  private constructor(private readonly options: LicenseRegistryOptions) {
    this.writer = IssuedLicenseWriterService.create(options);
  }

  /** Signs a new license for a customer and records it. */
  async issue(input: IssueLicenseTerms): Promise<SignedIssuedLicense> {
    const privateKey = this.writer.getSigningKey();
    const terms = resolveLicenseTerms({ current: null, input: input.terms });
    const organization = await this.resolveCustomer(input.customer);

    const { licenseKey } = this.options.generation.generate({
      organizationName: organization.name,
      email: input.email,
      planType: input.planType,
      ...licenseSeats({ members: input.maxMembers, membersLite: input.maxMembersLite }),
      maxMessagesPerMonth: input.maxMessagesPerMonth,
      expiresAt: toDate(input.expiresAt),
      // Signed into the license so the install reads its own entitlement
      // without a call. The registry row stays the authority the hosted routes
      // check, so a revoked service stops working before the license expires.
      connectServices: terms.services ?? [],
      privateKey,
      now: toDate(this.options.now()),
    });

    // Marked before the row exists. A license is handed over once, so the row
    // must be the last write that can fail: the other order loses the signed
    // license to a failure here and leaves a row no caller ever saw.
    await this.options.organizations.markSelfHostedCustomer(organization.id);
    const row = await this.writer.createRow({
      licenseKey,
      organizationId: organization.id,
      source: "BACKOFFICE",
      issuedById: input.operatorId,
      overrides: terms,
    });
    await this.syncBudget(row, input.operatorId);
    return { licenseKey, license: this.toView(row) };
  }

  /**
   * Records a license another flow already signed. Unlinked, it resolves to
   * nothing until an operator links it, and it never marks a self-hosted
   * customer: the mint script licenses a Cloud organization instead.
   */
  async record(input: {
    licenseKey: string;
    source: Extract<IssuedLicenseSource, "PURCHASE" | "SCRIPT">;
    organizationId?: string;
  }): Promise<IssuedLicenseView> {
    const row = await this.writer.createRow({
      licenseKey: input.licenseKey,
      organizationId: input.organizationId ?? null,
      source: input.source,
      issuedById: null,
    });
    return this.toView(row);
  }

  /**
   * Registers a license signed before the registry existed. The signature is
   * verified; the term is not, so a license that already ran out registers and
   * reads as expired.
   */
  async registerLegacy(input: {
    licenseKey: string;
    organizationId: string;
    operatorId: string;
  }): Promise<IssuedLicenseView> {
    const signed = this.options.cryptography.parseLicenseKey(input.licenseKey.trim());
    if (!signed || !this.options.cryptography.verifySignature(signed)) {
      throw new LicenseKeyInvalidError();
    }
    const organization = await this.resolveCustomer({ organizationId: input.organizationId });

    // Same order as `issue`: the row is the last write. A retry after a failure
    // here would otherwise find its own tokenHash taken and be refused as
    // already registered, with the organization never marked.
    await this.options.organizations.markSelfHostedCustomer(organization.id);
    const row = await this.writer.createRow({
      licenseKey: input.licenseKey,
      organizationId: organization.id,
      source: "LEGACY_IMPORT",
      issuedById: input.operatorId,
    });
    return this.toView(row);
  }

  async revoke(input: {
    id: string;
    operatorId: string;
    reason: string;
  }): Promise<IssuedLicenseView> {
    const row = await this.getRow(input.id);
    // An expired license can still be revoked: its term may be extended by a
    // reissue, and a leaked key should stay dead through that.
    this.refuseIfSettled(row);
    // The key ends first. If the row update then fails, the license reads as
    // active with a dead key, which resolves to a refusal, and revoking again
    // finishes the job. The other order could leave a revoked license whose
    // cached credential no gateway was told to drop.
    await this.retireManagedKey({ row, actorId: input.operatorId });
    const updated = await this.options.repository.update(row.id, {
      revokedAt: this.options.now(),
      revokedById: input.operatorId,
      revokedReason: input.reason,
      pendingDeliveryLicense: null,
    });
    await this.syncBudget(updated, input.operatorId);
    return this.toView(updated);
  }

  /**
   * Signs a replacement. The replaced license stays valid until the install
   * presents the new one, which is what authenticates the sync that delivers
   * it, and the replacement inherits the instance binding (ADR-156).
   */
  async reissue(input: {
    id: string;
    maxMembers?: number;
    maxMembersLite?: number;
    maxMessagesPerMonth?: number;
    expiresAt: Instant;
    operatorId: string;
  }): Promise<SignedIssuedLicense> {
    const current = await this.getRow(input.id);
    // Expired is allowed: renewing after a lapse is the common renewal.
    this.refuseIfSettled(current);
    const signed = await this.writer.signReplacement({ current, ...input });
    return { licenseKey: signed.licenseKey, license: this.toView(signed.row) };
  }

  /**
   * Signs a replacement for the same term. Seats raised on a linked license are
   * recorded in the replacement's own insert, the fact billing invoices from
   * (ARCHITECTURE.md section 9); removed seats are not credited.
   */
  async changeSeats(input: {
    id: string;
    maxMembers: number;
    operatorId: string;
  }): Promise<SeatChangeResult> {
    const current = await this.getRow(input.id);
    this.refuseUnlessActive(current);
    const raised = current.organizationId !== null && input.maxMembers > current.maxMembers;

    const { licenseKey, row } = await this.writer.signReplacement({
      current,
      maxMembers: input.maxMembers,
      expiresAt: current.expiresAt,
      operatorId: input.operatorId,
      ...(raised ? { seatsRaisedFrom: current.maxMembers } : {}),
    });

    return {
      licenseKey,
      license: this.toView(row),
      previousMaxMembers: current.maxMembers,
      billing: raised ? "pending" : "nothing_to_invoice",
    };
  }

  /** Every seat change that raised a linked license, as billing invoices it. */
  async findSeatChanges(input: { organizationId?: string }): Promise<LicenseSeatChange[]> {
    const rows = await this.options.repository.findAllSeatsRaised(input);
    return rows.flatMap((row) =>
      row.organizationId !== null && row.seatsRaisedFrom !== null
        ? [
            {
              licenseRowId: row.id,
              organizationId: row.organizationId,
              previousSeats: row.seatsRaisedFrom,
              seats: row.maxMembers,
              changedAt: row.issuedAt.toString(),
            },
          ]
        : [],
    );
  }

  async resetInstanceBinding(input: { id: string }): Promise<IssuedLicenseView> {
    const row = await this.getRow(input.id);
    const updated = await this.options.repository.update(row.id, {
      instanceId: null,
      instanceBoundAt: null,
    });
    // A gateway caches the credential per instance. Without this the install
    // that was just unbound keeps its cached entry until the token runs out,
    // and its key would still name the install it was bound to.
    if (row.virtualKeyId && row.organizationId) {
      await this.options.managedKeys.setLicense({
        virtualKeyId: row.virtualKeyId,
        organizationId: row.organizationId,
        tokenHash: row.tokenHash,
        instanceId: null,
        expiresAt: row.expiresAt,
      });
      await this.options.managedKeys.invalidate({
        virtualKeyId: row.virtualKeyId,
        organizationId: row.organizationId,
      });
    }
    return this.toView(updated);
  }

  /** Entitlements and commercial terms. None of them changes the license itself. */
  /**
   * Raises the prepaid commit of the customer's longest-running active
   * license, which is what a renewal or a top-up invoice agreed.
   */
  async raiseCommit({
    organizationId,
    byUsdCents,
    operatorId,
  }: {
    organizationId: string;
    byUsdCents: number;
    operatorId: string;
  }): Promise<IssuedLicenseView> {
    const rows = await this.options.repository.findAllByOrganization(organizationId);
    const now = this.options.now();
    const [active] = rows
      .filter((row) => statusOfIssuedLicense(row, now) === "active")
      .toSorted((a, b) => Temporal.Instant.compare(b.expiresAt, a.expiresAt));
    if (!active) throw new IssuedLicenseNotFoundError();

    return this.updateTerms({
      id: active.id,
      operatorId,
      commitUsdCents: active.commitUsdCents + byUsdCents,
    });
  }

  async updateTerms(
    input: { id: string; operatorId: string } & LicenseTermsInput,
  ): Promise<IssuedLicenseView> {
    const { id, operatorId, ...terms } = input;
    const row = await this.getRow(id);
    const updated = await this.options.repository.update(
      row.id,
      resolveLicenseTerms({ current: row, input: terms }),
    );
    await this.syncBudget(updated, operatorId);
    await this.publishConnectServices(updated);
    return this.toView(updated);
  }

  /** The gateway's copy of what the license's managed key may serve, rewritten on every change. */
  private async publishConnectServices(row: IssuedLicenseRecord): Promise<void> {
    if (!row.virtualKeyId || !row.organizationId) return;
    const active = statusOfIssuedLicense(row, this.options.now()) === "active";
    await this.options.managedKeys.setConnectServices({
      virtualKeyId: row.virtualKeyId,
      organizationId: row.organizationId,
      services: active ? entitledConnectServices(row.services) : [],
    });
  }

  async linkToOrganization(input: {
    id: string;
    organizationId: string;
    operatorId: string;
  }): Promise<IssuedLicenseView> {
    const row = await this.getRow(input.id);
    const organization = await this.resolveCustomer({ organizationId: input.organizationId });

    // A managed key belongs to the organization it was created on. Moving the
    // license ends it, and the next call creates one on the new organization.
    const moving = row.organizationId !== null && row.organizationId !== organization.id;
    if (moving) await this.retireManagedKey({ row, actorId: input.operatorId });

    const updated = await this.options.repository.update(row.id, {
      organizationId: organization.id,
      ...(moving ? { virtualKeyId: null } : {}),
    });
    await this.options.organizations.markSelfHostedCustomer(organization.id);
    if (moving && row.organizationId) {
      await this.options.contractBudgets.sync({
        organizationId: row.organizationId,
        operatorId: input.operatorId,
      });
    }
    await this.syncBudget(updated, input.operatorId);
    return this.toView(updated);
  }

  /**
   * Off the active license that runs longest: a reissue leaves both rows active
   * until the install presents the new one, and summing them counts seats twice.
   */
  async getConnectedSeats(organizationId: string): Promise<ConnectedSeats> {
    const licenses = await this.options.repository.findAllByOrganization(organizationId);
    const now = this.options.now();
    const active = licenses.filter((row) => statusOfIssuedLicense(row, now) === "active");
    const [current] = active.toSorted((a, b) => Temporal.Instant.compare(b.expiresAt, a.expiresAt));
    const [lastSyncAt] = active
      .flatMap((row) => (row.lastSyncAt ? [row.lastSyncAt] : []))
      .toSorted((a, b) => Temporal.Instant.compare(b, a));

    return {
      licensed: current?.maxMembers ?? 0,
      reported: current?.lastSyncAt ? (current.reportedMembers ?? 0) : null,
      lastSyncAt: lastSyncAt?.toString() ?? null,
      managedVirtualKeyId: licenses.find((row) => row.virtualKeyId)?.virtualKeyId ?? null,
    };
  }

  async getById(input: { id: string }): Promise<IssuedLicenseView> {
    return this.toView(await this.getRow(input.id));
  }

  async list(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<IssuedLicensePage> {
    const { rows, total } = await this.options.repository.listAll(input);
    return { licenses: rows.map((row) => this.toView(row)), total };
  }

  private async resolveCustomer(customer: LicenseCustomer): Promise<IssuedLicenseCustomerRecord> {
    if ("newOrganizationName" in customer) {
      return this.options.organizations.createSelfHostedCustomer({
        name: customer.newOrganizationName,
      });
    }
    const organization = await this.options.organizations.findById(customer.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    return organization;
  }

  private toView(row: IssuedLicenseRecord): IssuedLicenseView {
    return issuedLicenseView({ row, now: this.options.now() });
  }

  /** A license whose fate is settled admits no change; an expired one still may. */
  private refuseIfSettled(row: IssuedLicenseRecord): void {
    const status = statusOfIssuedLicense(row, this.options.now());
    if (status === "revoked" || status === "superseded") {
      throw new IssuedLicenseNotActiveError(status);
    }
  }

  private refuseUnlessActive(row: IssuedLicenseRecord): void {
    const status = statusOfIssuedLicense(row, this.options.now());
    if (status !== "active") throw new IssuedLicenseNotActiveError(status);
  }

  private async syncBudget(row: IssuedLicenseRecord, operatorId: string): Promise<void> {
    if (!row.organizationId) return;
    await this.options.contractBudgets.sync({ organizationId: row.organizationId, operatorId });
  }

  private async retireManagedKey({
    row,
    actorId,
  }: {
    row: IssuedLicenseRecord;
    actorId: string;
  }): Promise<void> {
    if (!row.virtualKeyId || !row.organizationId) return;
    await this.options.managedKeys.retire({
      virtualKeyId: row.virtualKeyId,
      organizationId: row.organizationId,
      actorId,
    });
  }

  private async getRow(id: string): Promise<IssuedLicenseRecord> {
    const row = await this.options.repository.findById(id);
    if (!row) throw new IssuedLicenseNotFoundError();
    return row;
  }
}

/**
 * The managed gateway key a license resolves to, which the gateway owns. Ending
 * or invalidating it is what reaches a gateway that already cached the
 * credential: both write to the change feed every gateway polls.
 */
export interface ConnectManagedKeys {
  provision(params: { organizationId: string; licenseId: string }): Promise<{ id: string }>;
  /** Ends the key for good. Safe to repeat. */
  retire(params: { virtualKeyId: string; organizationId: string; actorId: string }): Promise<void>;
  /** Makes every gateway resolve the license again on its next call. */
  invalidate(params: { virtualKeyId: string; organizationId: string }): Promise<void>;
  /** The platform services the gateway lets this key serve; empty serves none. */
  setConnectServices(params: {
    virtualKeyId: string;
    organizationId: string;
    services: readonly ConnectService[];
  }): Promise<void>;
  /**
   * The license the key serves, as the gateway resolves a token by it: the
   * registry hash, the bound install (none while unbound) and the term's end.
   */
  setLicense(params: {
    virtualKeyId: string;
    organizationId: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant;
  }): Promise<void>;
}

/** The customer a license is issued to, as the organization feature answers it. */
export interface LicenseCustomers {
  findById(id: string): Promise<{ id: string; name: string } | null>;
  createSelfHostedCustomer(params: { name: string }): Promise<{ id: string; name: string }>;
  markSelfHostedCustomer(id: string): Promise<void>;
}
