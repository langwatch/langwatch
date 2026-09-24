/**
 * The license registry (ADR-156): the record of every license LangWatch issued.
 * Every issue path goes through here, so a license never exists without its
 * row, and the signing key comes from a server secret rather than a caller.
 */

import {
  entitledConnectServices,
  type ConnectedSeats,
  type IssueLicenseInput as ContractIssueLicenseInput,
  IssuedLicenseNotActiveError,
  IssuedLicenseNotFoundError,
  LicenseAlreadyRegisteredError,
  LicenseAlreadyReissuedError,
  LicenseKeyInvalidError,
  LicenseOverageMaxRequiresOverageError,
  LicenseSigningNotConfiguredError,
  OrganizationNotFoundError,
  type IssuedLicenseCustomerRecord,
  type IssuedLicensePage,
  type IssuedLicenseSource,
  type IssuedLicenseView,
  type LicenseCustomer,
  type LicenseTermsInput,
  type SeatChangeResult,
  type SignedIssuedLicense,
} from "@langwatch/enterprise-licensing-contract";
import { registryHashForToken } from "@langwatch/gateway-contract";
import { licenseSeats } from "@langwatch/plans";
import { Temporal, toDate, type Instant } from "@langwatch/time";

import type {
  ConnectManagedKeys,
  ContractBudgets,
  LicenseCryptography,
  LicenseCustomers,
  LicenseDeliveryCipher,
  SeatChangeBilling,
} from "../app/licensing.members.ts";
import type {
  IssuedLicenseDraft,
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import {
  isUniqueViolation,
  issuedLicenseView,
  statusOfIssuedLicense,
  violationNames,
} from "../rules/issued-license.rules.ts";
import type { LicenseGenerationService } from "./license-generation.service.ts";

export interface LicenseRegistryOptions {
  repository: IssuedLicenseRepository;
  organizations: LicenseCustomers;
  managedKeys: ConnectManagedKeys;
  contractBudgets: ContractBudgets;
  seatBilling: SeatChangeBilling;
  cryptography: LicenseCryptography;
  generation: LicenseGenerationService;
  cipher: LicenseDeliveryCipher;
  /** The signing key from the server secret, or undefined when none is set. */
  signingKey: () => string | undefined;
  now: () => Instant;
}

/** What `issue` decides, with the term as an instant rather than a wire string. */
export type IssueLicenseTerms = Omit<ContractIssueLicenseInput, "expiresAt"> & {
  expiresAt: Instant;
};

type RowDraft = {
  licenseKey: string;
  organizationId: string | null;
  source: IssuedLicenseSource;
  issuedById: string | null;
  overrides?: Partial<IssuedLicenseRecord>;
};

export class LicenseRegistryService {
  static create(options: LicenseRegistryOptions): LicenseRegistryService {
    return new LicenseRegistryService(options);
  }

  private constructor(private readonly options: LicenseRegistryOptions) {}

  /** Signs a new license for a customer and records it. */
  async issue(input: IssueLicenseTerms): Promise<SignedIssuedLicense> {
    const privateKey = this.requireSigningKey();
    const terms = this.resolveTerms({ current: null, input: input.terms });
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
    const row = await this.createRow({
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
    const row = await this.createRow({
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
    const row = await this.createRow({
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
    const signed = await this.signReplacement({ current, ...input });
    return { licenseKey: signed.licenseKey, license: this.toView(signed.row) };
  }

  /**
   * Changes the seats of a running license: a replacement is signed for the
   * same term, added seats are invoiced prorated and removed ones are not
   * credited. A lapsed license is renewed through `reissue` instead.
   */
  async changeSeats(input: {
    id: string;
    maxMembers: number;
    operatorId: string;
  }): Promise<SeatChangeResult> {
    const current = await this.getRow(input.id);
    this.refuseUnlessActive(current);

    const { licenseKey, row } = await this.signReplacement({
      current,
      maxMembers: input.maxMembers,
      expiresAt: current.expiresAt,
      operatorId: input.operatorId,
    });

    // The license is signed and recorded before anything is invoiced, so a
    // billing failure leaves a customer with seats and an intent row to retry,
    // never an invoice for seats they never got.
    const billing =
      row.organizationId && input.maxMembers > current.maxMembers
        ? await this.options.seatBilling.invoiceAddedSeats({
            organizationId: row.organizationId,
            licenseRowId: row.id,
            previousSeats: current.maxMembers,
            seats: input.maxMembers,
            operatorId: input.operatorId,
          })
        : "nothing_to_invoice";

    return {
      licenseKey,
      license: this.toView(row),
      previousMaxMembers: current.maxMembers,
      billing,
    };
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
      this.resolveTerms({ current: row, input: terms }),
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

  /**
   * An overage maximum is only valid while overage is enabled, and switching
   * overage off clears it. Judged as the terms will stand, not as they arrived.
   */
  private resolveTerms({
    current,
    input,
  }: {
    current: IssuedLicenseRecord | null;
    input: LicenseTermsInput | undefined;
  }): LicenseTermsInput {
    if (!input) return {};
    const overageEnabled = input.overageEnabled ?? current?.overageEnabled ?? false;
    if (!overageEnabled && input.overageMaxUsdCents != null) {
      throw new LicenseOverageMaxRequiresOverageError();
    }
    if (!overageEnabled && input.overageEnabled === false) {
      return { ...input, overageMaxUsdCents: null };
    }
    return input;
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

  /** Signs a replacement for `current` and records it as waiting for delivery. */
  private async signReplacement(input: {
    current: IssuedLicenseRecord;
    maxMembers?: number;
    maxMembersLite?: number;
    maxMessagesPerMonth?: number;
    expiresAt: Instant;
    operatorId: string;
  }): Promise<{ licenseKey: string; row: IssuedLicenseRecord }> {
    const { current } = input;
    const { licenseKey } = this.options.generation.generate({
      organizationName: current.organizationName,
      email: current.email,
      planType: current.planType,
      ...licenseSeats({
        members: input.maxMembers ?? current.maxMembers,
        membersLite: input.maxMembersLite ?? current.maxMembersLite,
      }),
      maxMessagesPerMonth: input.maxMessagesPerMonth,
      expiresAt: toDate(input.expiresAt),
      connectServices: current.services,
      privateKey: this.requireSigningKey(),
      now: toDate(this.options.now()),
    });

    try {
      const row = await this.createRow({
        licenseKey,
        organizationId: current.organizationId,
        source: "BACKOFFICE",
        issuedById: input.operatorId,
        overrides: replacementColumns({ current, held: this.options.cipher.encrypt(licenseKey) }),
      });
      return { licenseKey, row };
    } catch (error) {
      // A tokenHash or licenseId clash is already named by the row writer. Only
      // a replacesId clash reaches here, and it means the license this one
      // replaces was reissued by somebody else first.
      if (error instanceof LicenseAlreadyRegisteredError) throw error;
      if (isUniqueViolation(error)) throw new LicenseAlreadyReissuedError();
      throw error;
    }
  }

  private async createRow(draft: RowDraft): Promise<IssuedLicenseRecord> {
    const signed = this.options.cryptography.parseLicenseKey(draft.licenseKey.trim());
    if (!signed) throw new LicenseKeyInvalidError();
    const token = this.options.cryptography.getLicenseToken(draft.licenseKey);

    const tokenHash = await registryHashForToken(token);
    // The read is what gives the operator the named refusal; the catch below
    // is what covers the write that raced it, because the table decides.
    if (await this.options.repository.findByTokenHash(tokenHash)) {
      throw new LicenseAlreadyRegisteredError();
    }
    try {
      return await this.options.repository.create({
        ...blankRow(),
        licenseId: signed.data.licenseId,
        organizationName: signed.data.organizationName,
        email: signed.data.email,
        planType: signed.data.plan.type,
        ...licenseSeats({
          members: signed.data.plan.maxMembers,
          membersLite: signed.data.plan.maxMembersLite,
        }),
        maxMembersLite: signed.data.plan.maxMembersLite ?? 0,
        issuedAt: Temporal.Instant.from(signed.data.issuedAt),
        expiresAt: Temporal.Instant.from(signed.data.expiresAt),
        tokenHash,
        organizationId: draft.organizationId,
        source: draft.source,
        issuedById: draft.issuedById,
        ...draft.overrides,
      });
    } catch (error) {
      // Two writes of the same key both pass the read above, and the unique
      // index refuses the second. A `replacesId` clash is `reissue`'s own
      // refusal; every other clash means the license is already registered.
      if (violationNames({ error, column: "replacesId" })) throw error;
      if (isUniqueViolation(error)) throw new LicenseAlreadyRegisteredError();
      throw error;
    }
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

  private requireSigningKey(): string {
    const privateKey = this.options.signingKey();
    if (!privateKey || privateKey.trim() === "") throw new LicenseSigningNotConfiguredError();
    return privateKey;
  }

  private async getRow(id: string): Promise<IssuedLicenseRecord> {
    const row = await this.options.repository.findById(id);
    if (!row) throw new IssuedLicenseNotFoundError();
    return row;
  }
}

/** What the replacement inherits from the license it replaces. */
function replacementColumns({
  current,
  held,
}: {
  current: IssuedLicenseRecord;
  held: string;
}): Partial<IssuedLicenseRecord> {
  return {
    replacesId: current.id,
    pendingDeliveryLicense: held,
    services: current.services,
    seatRateCents: current.seatRateCents,
    seatCurrency: current.seatCurrency,
    commitUsdCents: current.commitUsdCents,
    overageEnabled: current.overageEnabled,
    overageMaxUsdCents: current.overageMaxUsdCents,
    instanceId: current.instanceId,
    instanceBoundAt: current.instanceBoundAt,
  };
}

/** Every column a new row starts at, before the license and the caller speak. */
function blankRow(): Omit<
  IssuedLicenseDraft,
  | "licenseId"
  | "tokenHash"
  | "organizationId"
  | "organizationName"
  | "email"
  | "planType"
  | "maxMembers"
  | "maxMembersLite"
  | "issuedAt"
  | "expiresAt"
  | "source"
  | "issuedById"
> {
  return {
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    pendingDeliveryLicense: null,
    services: [],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 0,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: null,
    instanceBoundAt: null,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    virtualKeyId: null,
  };
}
