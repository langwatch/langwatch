/**
 * The tokens that can only ask for a testing licence (ADR-180 section 2): minted for a person
 * by the CLI sign-in, or for CI by an ops manager. Every token acts as the person who made it,
 * whom the door hands on and asks for ops permissions on every call.
 */

import {
  TestingLicenseServiceTokenLifetimeTooLongError,
  TestingLicenseTokenExpiredError,
  TestingLicenseTokenInvalidError,
  TestingLicenseTokenNotFoundError,
  TestingLicenseTokenRevokedError,
  type MintedTestingLicenseToken,
  type TestingLicenseIssuer,
  type TestingLicenseTokenKind,
  type TestingLicenseTokenPage,
  type TestingLicenseTokenView,
} from "@langwatch/enterprise-licensing-contract";
import { generate } from "@langwatch/ksuid";
import type { Instant } from "@langwatch/time";

import type {
  TestingLicenseTokenRecord,
  TestingLicenseTokenRepository,
} from "../repositories/testing-license-token.repository.ts";
import {
  isTestingLicenseTokenShaped,
  mintTestingLicenseToken,
  PERSONAL_TOKEN_LIFETIME_DAYS,
  SERVICE_TOKEN_DEFAULT_DAYS,
  SERVICE_TOKEN_MAX_DAYS,
  statusOfTestingLicenseToken,
  TESTING_LICENSE_TOKEN_KSUID_RESOURCE,
  testingLicenseTokenExpiry,
  testingLicenseTokenHash,
} from "../rules/testing-license-token.rules.ts";

export class TestingLicenseTokenService {
  static create(options: {
    repository: TestingLicenseTokenRepository;
    now: () => Instant;
  }): TestingLicenseTokenService {
    return new TestingLicenseTokenService(options.repository, options.now);
  }

  private constructor(
    private readonly repository: TestingLicenseTokenRepository,
    private readonly now: () => Instant,
  ) {}

  /** The user a bearer belongs to; unknown, expired and revoked are each refused by code. */
  async verify({ bearer }: { bearer: string | null }): Promise<TestingLicenseIssuer> {
    if (!isTestingLicenseTokenShaped(bearer)) throw new TestingLicenseTokenInvalidError();
    const [row] = await this.repository.findByTokenHash(testingLicenseTokenHash(bearer));
    if (!row) throw new TestingLicenseTokenInvalidError();

    const status = statusOfTestingLicenseToken(row, this.now());
    if (status === "revoked") throw new TestingLicenseTokenRevokedError();
    if (status === "expired") throw new TestingLicenseTokenExpiredError();

    return { kind: row.kind, tokenId: row.id, userId: row.ownerUserId };
  }

  /** A personal token for the person a CLI sign-in approved. */
  async mintPersonal({
    userId,
  }: {
    userId: string;
  }): Promise<{ token: string; expiresAt: string }> {
    const { token, row } = await this.mint({
      kind: "personal",
      ownerUserId: userId,
      name: null,
      days: PERSONAL_TOKEN_LIFETIME_DAYS,
    });
    return { token, expiresAt: row.expiresAt.toString() };
  }

  /** A named CI token acting as the ops manager who made it; past a year is refused. */
  async createService({
    name,
    expiresInDays,
    operatorId,
  }: {
    name: string;
    expiresInDays?: number;
    operatorId: string;
  }): Promise<MintedTestingLicenseToken> {
    const days = expiresInDays ?? SERVICE_TOKEN_DEFAULT_DAYS;
    if (days > SERVICE_TOKEN_MAX_DAYS) {
      throw new TestingLicenseServiceTokenLifetimeTooLongError({ maxDays: SERVICE_TOKEN_MAX_DAYS });
    }
    const { token, row } = await this.mint({
      kind: "service",
      ownerUserId: operatorId,
      name,
      days,
    });
    return { token, testingLicenseToken: this.view(row) };
  }

  async list({
    page,
    pageSize,
  }: {
    page: number;
    pageSize: number;
  }): Promise<TestingLicenseTokenPage> {
    const { rows, total } = await this.repository.listAll({ page, pageSize });
    return { tokens: rows.map((row) => this.view(row)), total };
  }

  /** Any ops manager may revoke any token, and its user their own; twice keeps the first. */
  async revoke({
    id,
    operatorId,
  }: {
    id: string;
    operatorId: string;
  }): Promise<TestingLicenseTokenView> {
    const [found] = await this.repository.findById(id);
    if (!found) throw new TestingLicenseTokenNotFoundError();
    await this.repository.revoke({ id, at: this.now(), revokedById: operatorId });
    const [revoked] = await this.repository.findById(id);
    return this.view(revoked ?? found);
  }

  /** Stamps the token's last use once it has issued a testing licence. */
  async recordUse({ tokenId }: { tokenId: string }): Promise<void> {
    await this.repository.recordUse({ id: tokenId, at: this.now() });
  }

  private async mint({
    kind,
    ownerUserId,
    name,
    days,
  }: {
    kind: TestingLicenseTokenKind;
    ownerUserId: string;
    name: string | null;
    days: number;
  }): Promise<{ token: string; row: TestingLicenseTokenRecord }> {
    const token = mintTestingLicenseToken();
    const row = await this.repository.create({
      id: generate(TESTING_LICENSE_TOKEN_KSUID_RESOURCE).toString(),
      tokenHash: testingLicenseTokenHash(token),
      kind,
      ownerUserId,
      name,
      expiresAt: testingLicenseTokenExpiry({ now: this.now(), days }),
    });
    return { token, row };
  }

  private view(row: TestingLicenseTokenRecord): TestingLicenseTokenView {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      ownerUserId: row.ownerUserId,
      expiresAt: row.expiresAt.toString(),
      revokedAt: row.revokedAt?.toString() ?? null,
      revokedById: row.revokedById,
      lastUsedAt: row.lastUsedAt?.toString() ?? null,
      createdAt: row.createdAt.toString(),
      status: statusOfTestingLicenseToken(row, this.now()),
    };
  }
}
