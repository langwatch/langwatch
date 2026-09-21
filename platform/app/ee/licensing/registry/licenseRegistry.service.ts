/**
 * The license registry (ADR-141): the record of every license LangWatch issued.
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
 * row, the ports and the derived rules are in `./issuedLicense.ts`, writing a
 * row in `./issuedLicenseRows.ts`, reading one back in
 * `./issuedLicenseViews.ts`, the commercial terms in `./licenseTerms.ts`, the
 * customer in `./licenseCustomers.ts`, what follows a change in
 * `./licenseSideEffects.ts`, and the Prisma bindings in
 * `./issuedLicense.prisma.ts`.
 */

import { LicenseKeyInvalidError } from "../errors";
import { generateLicenseKey } from "../licenseGenerationService";
import { parseLicenseKey, verifySignature } from "../validation";
import {
  IssuedLicenseNotActiveError,
  IssuedLicenseNotFoundError,
  LicenseAlreadyRegisteredError,
  LicenseAlreadyReissuedError,
  LicenseSigningNotConfiguredError,
} from "./errors";
import {
  type IssuedLicenseBrowseView,
  type IssuedLicenseRecord,
  type IssuedLicenseSource,
  type IssuedLicenseView,
  type LicenseCustomer,
  type LicenseRegistryDependencies,
  type LicenseTermsInput,
  statusOfIssuedLicense,
} from "./issuedLicense";
import { createIssuedLicenseRow, isUniqueViolation } from "./issuedLicenseRows";
import { browseIssuedLicenses, issuedLicenseView } from "./issuedLicenseViews";
import { resolveLicenseCustomer } from "./licenseCustomers";
import { retireManagedKeyOf, syncContractBudgetOf } from "./licenseSideEffects";
import { resolveLicenseTerms } from "./licenseTerms";

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
    const terms = resolveLicenseTerms({ current: null, input: input.terms });
    const organization = await resolveLicenseCustomer({
      organizations: this.deps.organizations,
      customer: input.customer,
    });

    const { licenseKey } = generateLicenseKey({
      organizationName: organization.name,
      email: input.email,
      planType: input.planType,
      maxMembers: input.maxMembers,
      maxMembersLite: input.maxMembersLite,
      maxMessagesPerMonth: input.maxMessagesPerMonth,
      expiresAt: input.expiresAt,
      // Signed into the license so the install reads its own entitlement
      // without a call. The registry row stays the authority the hosted routes
      // check, so a revoked service stops working before the license expires.
      connectServices: terms.services ?? [],
      privateKey,
      now: this.now(),
    });

    // Marked before the row exists. A license is handed over once, so the row
    // must be the last write that can fail: the other order loses the signed
    // license to a failure here and leaves a registry row no caller ever saw.
    // Marking an organization that then gets no license changes nothing but a
    // flag, and issuing again sets the same flag.
    await this.deps.organizations.markSelfHostedCustomer(organization.id);
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
    const organization = await resolveLicenseCustomer({
      organizations: this.deps.organizations,
      customer: { organizationId: input.organizationId },
    });

    // Same order as `issue`: the row is the last write. A retry after a failure
    // here would otherwise find its own tokenHash already taken and be refused
    // as already registered, with the organization never marked.
    await this.deps.organizations.markSelfHostedCustomer(organization.id);
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
    const row = await this.requireRow(input.id);
    const status = statusOfIssuedLicense(row, this.now());
    // An expired license can still be revoked: its term may be extended by a
    // reissue, and a leaked key should stay dead through that.
    if (status === "revoked" || status === "superseded") {
      throw new IssuedLicenseNotActiveError(status);
    }
    // The key ends first. If the row update then fails, the license reads as
    // active with a dead key, which resolves to a refusal, and revoking again
    // finishes the job. The other order could leave a revoked license whose
    // cached credential no gateway was told to drop.
    await this.retireManagedKey({ row, actorId: input.operatorId });
    const updated = await this.deps.repository.update(row.id, {
      revokedAt: this.now(),
      revokedById: input.operatorId,
      revokedReason: input.reason,
      pendingDeliveryLicense: null,
    });
    await this.syncBudget(updated, input.operatorId);
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
      connectServices: current.services,
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
    // A gateway caches the credential per instance. Without this the install
    // that was just unbound keeps its cached entry until the token runs out.
    if (row.virtualKeyId && row.organizationId) {
      await this.deps.managedKeys.invalidate({
        virtualKeyId: row.virtualKeyId,
        organizationId: row.organizationId,
      });
    }
    return this.toView(updated);
  }

  /** Entitlements and commercial terms. None of them changes the license itself. */
  async updateTerms(
    input: { id: string; operatorId: string } & LicenseTermsInput,
  ): Promise<IssuedLicenseView> {
    const { id, operatorId, ...terms } = input;
    const row = await this.requireRow(id);
    const resolved = resolveLicenseTerms({ current: row, input: terms });
    const updated = await this.deps.repository.update(row.id, resolved);
    await this.syncBudget(updated, operatorId);
    return this.toView(updated);
  }

  async linkToOrganization(input: {
    id: string;
    organizationId: string;
    operatorId: string;
  }): Promise<IssuedLicenseView> {
    const row = await this.requireRow(input.id);
    const organization = await resolveLicenseCustomer({
      organizations: this.deps.organizations,
      customer: { organizationId: input.organizationId },
    });

    // A managed key belongs to the organization it was created on. Moving the
    // license ends it, and the next call creates one on the new organization.
    const isMovingToDifferentOrganization =
      row.organizationId !== null && row.organizationId !== organization.id;
    if (isMovingToDifferentOrganization) {
      await this.retireManagedKey({ row, actorId: input.operatorId });
    }

    const updated = await this.deps.repository.update(row.id, {
      organizationId: organization.id,
      ...(isMovingToDifferentOrganization ? { virtualKeyId: null } : {}),
    });
    await this.deps.organizations.markSelfHostedCustomer(organization.id);
    if (isMovingToDifferentOrganization && row.organizationId) {
      await this.deps.contractBudgets.sync({
        organizationId: row.organizationId,
        operatorId: input.operatorId,
      });
    }
    await this.syncBudget(updated, input.operatorId);
    return this.toView(updated);
  }

  async getById(input: { id: string }): Promise<IssuedLicenseBrowseView> {
    const [license] = await this.browseRows([await this.requireRow(input.id)]);
    if (!license) throw new IssuedLicenseNotFoundError();
    return license;
  }

  async getAll(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ licenses: IssuedLicenseBrowseView[]; total: number }> {
    const { rows, total } = await this.deps.repository.findAll(input);
    return { licenses: await this.browseRows(rows), total };
  }

  private browseRows(
    rows: IssuedLicenseRecord[],
  ): Promise<IssuedLicenseBrowseView[]> {
    return browseIssuedLicenses({
      rows,
      seatReports: this.deps.seatReports,
      now: this.now(),
    });
  }

  private toView(row: IssuedLicenseRecord): IssuedLicenseView {
    return issuedLicenseView({ row, now: this.now() });
  }

  private syncBudget(row: IssuedLicenseRecord, operatorId: string) {
    return syncContractBudgetOf({
      contractBudgets: this.deps.contractBudgets,
      row,
      operatorId,
    });
  }

  private retireManagedKey(params: {
    row: IssuedLicenseRecord;
    actorId: string;
  }) {
    return retireManagedKeyOf({
      managedKeys: this.deps.managedKeys,
      ...params,
    });
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

  private createRow(params: {
    licenseKey: string;
    organizationId: string | null;
    source: IssuedLicenseSource;
    issuedById: string | null;
    overrides?: Partial<IssuedLicenseRecord>;
  }): Promise<IssuedLicenseRecord> {
    return createIssuedLicenseRow({
      repository: this.deps.repository,
      ...params,
    });
  }
}
