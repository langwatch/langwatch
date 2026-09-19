/**
 * The license registry (ADR-139): the record of every license LangWatch issued.
 *
 * Every issue path goes through here, so a license never exists without its
 * row: the backoffice (`issue`, `reissue`), the purchase flow and the mint
 * script (`record`), and licenses signed before the registry existed
 * (`registerLegacy`).
 *
 * The signing key is read from a server secret through `signingKey`. No caller
 * supplies one.
 *
 * Dependencies are injected so the rules are testable without a database. The
 * Prisma bindings live in `./issuedLicense.prisma.ts`.
 */

import { LicenseKeyInvalidError, OrganizationNotFoundError } from "../errors";
import { generateLicenseKey } from "../licenseGenerationService";
import { licenseTokenFromKey, registryHashForToken } from "../licenseToken";
import type { SignedLicense } from "../types";
import { parseLicenseKey, verifySignature } from "../validation";
import {
  IssuedLicenseNotActiveError,
  IssuedLicenseNotFoundError,
  LicenseAlreadyRegisteredError,
  LicenseAlreadyReissuedError,
  LicenseOverageMaxRequiresOverageError,
  LicenseSigningNotConfiguredError,
} from "./errors";

/** Hosted services a license can be entitled to. */
export const CONNECT_SERVICES = ["instant_evals", "managed_models"] as const;
export type ConnectService = (typeof CONNECT_SERVICES)[number];

export type IssuedLicenseSource =
  | "BACKOFFICE"
  | "PURCHASE"
  | "SCRIPT"
  | "LEGACY_IMPORT";

export type SeatCurrency = "USD" | "EUR";

/** A registry row, as stored. */
export interface IssuedLicenseRecord {
  id: string;
  licenseId: string;
  tokenHash: string;
  organizationId: string | null;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  maxMembersLite: number;
  issuedAt: Date;
  expiresAt: Date;
  source: IssuedLicenseSource;
  issuedById: string | null;
  revokedAt: Date | null;
  revokedById: string | null;
  revokedReason: string | null;
  supersededAt: Date | null;
  replacesId: string | null;
  pendingDeliveryLicense: string | null;
  services: string[];
  seatOverageAllowance: number | null;
  seatRateCents: number | null;
  seatCurrency: SeatCurrency | null;
  commitUsdCents: number;
  overageEnabled: boolean;
  overageMaxUsdCents: number | null;
  instanceId: string | null;
  instanceBoundAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IssuedLicenseStatus =
  | "active"
  | "revoked"
  | "superseded"
  | "expired";

/**
 * A registry row as the backoffice reads it: the stored row without the held
 * license, plus what is derived from it.
 */
export type IssuedLicenseView = Omit<
  IssuedLicenseRecord,
  "pendingDeliveryLicense"
> & {
  status: IssuedLicenseStatus;
  /** The allowance in force: the override, or a fifth of the seats rounded up. */
  effectiveSeatOverageAllowance: number;
  /** Whether a reissued license is waiting to be delivered to its install. */
  hasPendingDelivery: boolean;
};

export interface IssuedLicenseRepository {
  create(
    data: Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<IssuedLicenseRecord>;
  findById(id: string): Promise<IssuedLicenseRecord | null>;
  findByTokenHash(tokenHash: string): Promise<IssuedLicenseRecord | null>;
  findAll(params: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: IssuedLicenseRecord[]; total: number }>;
  update(
    id: string,
    data: Partial<Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<IssuedLicenseRecord>;
}

export interface CustomerOrganizationPort {
  findById(id: string): Promise<{ id: string; name: string } | null>;
  createSelfHostedCustomer(params: {
    name: string;
  }): Promise<{ id: string; name: string }>;
  markSelfHostedCustomer(id: string): Promise<void>;
}

export interface LicenseRegistryDependencies {
  repository: IssuedLicenseRepository;
  organizations: CustomerOrganizationPort;
  /** The signing key from the server secret, or undefined when none is set. */
  signingKey: () => string | undefined;
  /** The key licenses are verified against. */
  publicKey: string;
  /** Encrypts a license held for delivery. */
  encrypt: (plain: string) => string;
  now?: () => Date;
}

/** The customer a license is issued to: one that exists, or a new one to create. */
export type LicenseCustomer =
  | { organizationId: string }
  | { newOrganizationName: string };

export interface LicenseTermsInput {
  services?: ConnectService[];
  /** Null clears the override, so the default applies again. */
  seatOverageAllowance?: number | null;
  seatRateCents?: number | null;
  seatCurrency?: SeatCurrency | null;
  commitUsdCents?: number;
  overageEnabled?: boolean;
  overageMaxUsdCents?: number | null;
}

/** A fifth of the licensed seats, rounded up. */
const DEFAULT_ALLOWANCE_DIVISOR = 5;

export function defaultSeatOverageAllowance(maxMembers: number): number {
  return Math.ceil(maxMembers / DEFAULT_ALLOWANCE_DIVISOR);
}

/** Revoked wins over superseded, which wins over the term. */
export function statusOfIssuedLicense(
  row: Pick<IssuedLicenseRecord, "revokedAt" | "supersededAt" | "expiresAt">,
  now: Date,
): IssuedLicenseStatus {
  if (row.revokedAt) return "revoked";
  if (row.supersededAt) return "superseded";
  if (now >= row.expiresAt) return "expired";
  return "active";
}

export class LicenseRegistryService {
  private readonly now: () => Date;

  constructor(private readonly deps: LicenseRegistryDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Signs a new license for a customer and records it. */
  async issue(input: {
    customer: LicenseCustomer;
    email: string;
    planType: string;
    maxMembers: number;
    maxMembersLite?: number;
    maxMessagesPerMonth?: number;
    expiresAt: Date;
    terms?: LicenseTermsInput;
    operatorId: string;
  }): Promise<{ licenseKey: string; license: IssuedLicenseView }> {
    const privateKey = this.requireSigningKey();
    const terms = this.resolveTerms({ current: null, input: input.terms });
    const organization = await this.resolveCustomer(input.customer);

    const { licenseKey } = generateLicenseKey({
      organizationName: organization.name,
      email: input.email,
      planType: input.planType,
      maxMembers: input.maxMembers,
      maxMembersLite: input.maxMembersLite,
      maxMessagesPerMonth: input.maxMessagesPerMonth,
      expiresAt: input.expiresAt,
      privateKey,
      now: this.now(),
    });

    const row = await this.createRow({
      licenseKey,
      organizationId: organization.id,
      source: "BACKOFFICE",
      issuedById: input.operatorId,
      overrides: terms,
    });
    await this.deps.organizations.markSelfHostedCustomer(organization.id);
    return { licenseKey, license: this.toView(row) };
  }

  /**
   * Records a license that another flow already signed: the purchase flow and
   * the mint script. Without an organization it is recorded unlinked and
   * resolves to nothing until an operator links it.
   *
   * It never marks the organization as a self-hosted customer. The mint script
   * applies a license to an organization in its own database, which makes that
   * a licensed LangWatch Cloud organization, not a customer running self-hosted.
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
   * Registers a license that was signed before the registry existed. The
   * signature is verified; the term is not, so a license that already ran out
   * can be registered and reads as expired.
   */
  async registerLegacy(input: {
    licenseKey: string;
    organizationId: string;
    operatorId: string;
  }): Promise<IssuedLicenseView> {
    const signed = parseLicenseKey(input.licenseKey.trim());
    if (!signed || !verifySignature(signed, this.deps.publicKey)) {
      throw new LicenseKeyInvalidError();
    }
    const organization = await this.deps.organizations.findById(
      input.organizationId,
    );
    if (!organization) throw new OrganizationNotFoundError();

    const row = await this.createRow({
      licenseKey: input.licenseKey,
      organizationId: organization.id,
      source: "LEGACY_IMPORT",
      issuedById: input.operatorId,
    });
    await this.deps.organizations.markSelfHostedCustomer(organization.id);
    return this.toView(row);
  }

  async revoke(input: {
    id: string;
    operatorId: string;
    reason: string;
  }): Promise<IssuedLicenseView> {
    const row = await this.requireRow(input.id);
    const status = statusOfIssuedLicense(row, this.now());
    // An expired license can still be revoked: its term may be extended by a
    // reissue, and a leaked key should stay dead through that.
    if (status === "revoked" || status === "superseded") {
      throw new IssuedLicenseNotActiveError(status);
    }
    const updated = await this.deps.repository.update(row.id, {
      revokedAt: this.now(),
      revokedById: input.operatorId,
      revokedReason: input.reason,
      pendingDeliveryLicense: null,
    });
    return this.toView(updated);
  }

  /**
   * Signs a replacement for a license. The replaced license stays valid until
   * the install presents the new one, because it is what authenticates the
   * sync that delivers it.
   *
   * The new license inherits the instance binding, so a reissued license that
   * leaks cannot be bound by another install first.
   */
  async reissue(input: {
    id: string;
    maxMembers?: number;
    maxMembersLite?: number;
    maxMessagesPerMonth?: number;
    expiresAt: Date;
    operatorId: string;
  }): Promise<{ licenseKey: string; license: IssuedLicenseView }> {
    const privateKey = this.requireSigningKey();
    const current = await this.requireRow(input.id);
    const status = statusOfIssuedLicense(current, this.now());
    // Expired is allowed: renewing after a lapse is the common renewal.
    if (status === "revoked" || status === "superseded") {
      throw new IssuedLicenseNotActiveError(status);
    }

    const { licenseKey } = generateLicenseKey({
      organizationName: current.organizationName,
      email: current.email,
      planType: current.planType,
      maxMembers: input.maxMembers ?? current.maxMembers,
      maxMembersLite: input.maxMembersLite ?? current.maxMembersLite,
      maxMessagesPerMonth: input.maxMessagesPerMonth,
      expiresAt: input.expiresAt,
      privateKey,
      now: this.now(),
    });

    let row: IssuedLicenseRecord;
    try {
      row = await this.createRow({
        licenseKey,
        organizationId: current.organizationId,
        source: "BACKOFFICE",
        issuedById: input.operatorId,
        overrides: {
          replacesId: current.id,
          pendingDeliveryLicense: this.deps.encrypt(licenseKey),
          services: current.services,
          seatOverageAllowance: current.seatOverageAllowance,
          seatRateCents: current.seatRateCents,
          seatCurrency: current.seatCurrency,
          commitUsdCents: current.commitUsdCents,
          overageEnabled: current.overageEnabled,
          overageMaxUsdCents: current.overageMaxUsdCents,
          instanceId: current.instanceId,
          instanceBoundAt: current.instanceBoundAt,
        },
      });
    } catch (error) {
      if (error instanceof LicenseAlreadyRegisteredError) throw error;
      if (isUniqueViolation(error)) throw new LicenseAlreadyReissuedError();
      throw error;
    }
    return { licenseKey, license: this.toView(row) };
  }

  async resetInstanceBinding(input: {
    id: string;
  }): Promise<IssuedLicenseView> {
    const row = await this.requireRow(input.id);
    const updated = await this.deps.repository.update(row.id, {
      instanceId: null,
      instanceBoundAt: null,
    });
    return this.toView(updated);
  }

  /** Entitlements and commercial terms. None of them changes the license itself. */
  async updateTerms(
    input: { id: string } & LicenseTermsInput,
  ): Promise<IssuedLicenseView> {
    const { id, ...terms } = input;
    const row = await this.requireRow(id);
    const resolved = this.resolveTerms({ current: row, input: terms });
    const updated = await this.deps.repository.update(row.id, resolved);
    return this.toView(updated);
  }

  async linkToOrganization(input: {
    id: string;
    organizationId: string;
  }): Promise<IssuedLicenseView> {
    const row = await this.requireRow(input.id);
    const organization = await this.deps.organizations.findById(
      input.organizationId,
    );
    if (!organization) throw new OrganizationNotFoundError();

    const updated = await this.deps.repository.update(row.id, {
      organizationId: organization.id,
    });
    await this.deps.organizations.markSelfHostedCustomer(organization.id);
    return this.toView(updated);
  }

  async getById(input: { id: string }): Promise<IssuedLicenseView> {
    return this.toView(await this.requireRow(input.id));
  }

  async getAll(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ licenses: IssuedLicenseView[]; total: number }> {
    const { rows, total } = await this.deps.repository.findAll(input);
    return { licenses: rows.map((row) => this.toView(row)), total };
  }

  private requireSigningKey(): string {
    const privateKey = this.deps.signingKey();
    if (!privateKey || privateKey.trim() === "") {
      throw new LicenseSigningNotConfiguredError();
    }
    return privateKey;
  }

  private async requireRow(id: string): Promise<IssuedLicenseRecord> {
    const row = await this.deps.repository.findById(id);
    if (!row) throw new IssuedLicenseNotFoundError();
    return row;
  }

  private async resolveCustomer(
    customer: LicenseCustomer,
  ): Promise<{ id: string; name: string }> {
    if ("newOrganizationName" in customer) {
      return this.deps.organizations.createSelfHostedCustomer({
        name: customer.newOrganizationName,
      });
    }
    const organization = await this.deps.organizations.findById(
      customer.organizationId,
    );
    if (!organization) throw new OrganizationNotFoundError();
    return organization;
  }

  /**
   * The terms to store, checked as they will stand after the change: an
   * overage maximum is only valid while overage is enabled, and switching
   * overage off clears it.
   */
  private resolveTerms({
    current,
    input,
  }: {
    current: IssuedLicenseRecord | null;
    input: LicenseTermsInput | undefined;
  }): LicenseTermsInput {
    if (!input) return {};
    const overageEnabled =
      input.overageEnabled ?? current?.overageEnabled ?? false;

    if (!overageEnabled && input.overageMaxUsdCents != null) {
      throw new LicenseOverageMaxRequiresOverageError();
    }
    if (!overageEnabled && input.overageEnabled === false) {
      return { ...input, overageMaxUsdCents: null };
    }
    return input;
  }

  private async createRow({
    licenseKey,
    organizationId,
    source,
    issuedById,
    overrides = {},
  }: {
    licenseKey: string;
    organizationId: string | null;
    source: IssuedLicenseSource;
    issuedById: string | null;
    overrides?: Partial<IssuedLicenseRecord>;
  }): Promise<IssuedLicenseRecord> {
    const signed = parseLicenseKey(licenseKey.trim());
    const token = licenseTokenFromKey(licenseKey);
    if (!signed || !token) throw new LicenseKeyInvalidError();

    const tokenHash = registryHashForToken(token);
    if (await this.deps.repository.findByTokenHash(tokenHash)) {
      throw new LicenseAlreadyRegisteredError();
    }
    return this.deps.repository.create({
      ...rowFromSignedLicense(signed),
      tokenHash,
      organizationId,
      source,
      issuedById,
      revokedAt: null,
      revokedById: null,
      revokedReason: null,
      supersededAt: null,
      replacesId: null,
      pendingDeliveryLicense: null,
      services: [],
      seatOverageAllowance: null,
      seatRateCents: null,
      seatCurrency: null,
      commitUsdCents: 0,
      overageEnabled: false,
      overageMaxUsdCents: null,
      instanceId: null,
      instanceBoundAt: null,
      ...overrides,
    });
  }

  private toView(row: IssuedLicenseRecord): IssuedLicenseView {
    const { pendingDeliveryLicense, ...stored } = row;
    return {
      ...stored,
      status: statusOfIssuedLicense(row, this.now()),
      effectiveSeatOverageAllowance:
        row.seatOverageAllowance ?? defaultSeatOverageAllowance(row.maxMembers),
      hasPendingDelivery: pendingDeliveryLicense !== null,
    };
  }
}

/** What the signed license itself says, which is the source for these columns. */
function rowFromSignedLicense(
  signed: SignedLicense,
): Pick<
  IssuedLicenseRecord,
  | "licenseId"
  | "organizationName"
  | "email"
  | "planType"
  | "maxMembers"
  | "maxMembersLite"
  | "issuedAt"
  | "expiresAt"
> {
  return {
    licenseId: signed.data.licenseId,
    organizationName: signed.data.organizationName,
    email: signed.data.email,
    planType: signed.data.plan.type,
    maxMembers: signed.data.plan.maxMembers,
    maxMembersLite: signed.data.plan.maxMembersLite ?? 0,
    issuedAt: new Date(signed.data.issuedAt),
    expiresAt: new Date(signed.data.expiresAt),
  };
}

/** Prisma's unique constraint violation, without importing Prisma here. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
