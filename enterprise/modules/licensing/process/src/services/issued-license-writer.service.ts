import type {
  LicenseCryptography,
  LicenseGenerationService,
} from "@langwatch/enterprise-license-signing";
import {
  LicenseAlreadyRegisteredError,
  LicenseAlreadyReissuedError,
  LicenseKeyInvalidError,
  LicenseSigningNotConfiguredError,
  type IssuedLicenseSource,
} from "@langwatch/enterprise-licensing-contract";
import { registryHashForToken } from "@langwatch/gateway-contract";
import { licenseSeats } from "@langwatch/plans";
import { Temporal, toDate, type Instant } from "@langwatch/time";

import type {
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import { blankIssuedLicenseRow, replacementColumns } from "../rules/issued-license-row.rules.ts";
import { isUniqueViolation, violationNames } from "../rules/issued-license.rules.ts";

type IssuedLicenseRowDraft = {
  licenseKey: string;
  organizationId: string | null;
  source: IssuedLicenseSource;
  issuedById: string | null;
  overrides?: Partial<IssuedLicenseRecord>;
};

/** Signs license keys and writes registry rows, naming every refusal the table raises. */
export class IssuedLicenseWriterService {
  static create(options: {
    repository: IssuedLicenseRepository;
    cryptography: LicenseCryptography;
    generation: LicenseGenerationService;
    signingKey: () => string | undefined;
    now: () => Instant;
  }): IssuedLicenseWriterService {
    return new IssuedLicenseWriterService(options);
  }

  private constructor(
    private readonly options: {
      repository: IssuedLicenseRepository;
      cryptography: LicenseCryptography;
      generation: LicenseGenerationService;
      signingKey: () => string | undefined;
      now: () => Instant;
    },
  ) {}

  /** Signs a replacement for `current` and records it as waiting for delivery. */
  async signReplacement(input: {
    current: IssuedLicenseRecord;
    maxMembers?: number;
    maxMembersLite?: number;
    maxMessagesPerMonth?: number;
    expiresAt: Instant;
    operatorId: string;
    /** Set by a seat change that raised a linked license; see `changeSeats`. */
    seatsRaisedFrom?: number;
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
      privateKey: this.getSigningKey(),
      now: toDate(this.options.now()),
    });

    try {
      const row = await this.createRow({
        licenseKey,
        organizationId: current.organizationId,
        source: "BACKOFFICE",
        issuedById: input.operatorId,
        overrides: {
          ...replacementColumns({ current, held: licenseKey }),
          seatsRaisedFrom: input.seatsRaisedFrom ?? null,
        },
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

  async createRow(draft: IssuedLicenseRowDraft): Promise<IssuedLicenseRecord> {
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
        ...blankIssuedLicenseRow(),
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

  /** The signing key from the server secret; refuses when none is set. */
  getSigningKey(): string {
    const privateKey = this.options.signingKey();
    if (!privateKey || privateKey.trim() === "") throw new LicenseSigningNotConfiguredError();
    return privateKey;
  }
}
