import { randomInt } from "node:crypto";

import {
  type IssuedSigningKey,
  SIGNING_KEY_PREFIX,
  SIGNING_KEY_ROTATION_OVERLAP_MS,
  type SigningKey,
  SigningKeyNotFoundError,
} from "@langwatch/api-key-contract";
import { generate } from "@langwatch/ksuid";
import type { ProjectApi } from "@langwatch/project-contract";
import { type Instant, nowInstant, toDate } from "@langwatch/time";

import type { SigningKeyUsageRepository } from "../repositories/signing-key-usage.repository.ts";
import type {
  SigningKeyRepository,
  SigningKeyRow,
} from "../repositories/signing-key.repository.ts";
import { signingKeyStatusOf, signingKeyUsageHourOf } from "../rules/signing-key.rules.ts";
import type { BraidSignatureVerificationService } from "./braid-signature-verification.service.ts";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PUBLIC_ID_LENGTH = 16;
const SECRET_LENGTH = 40;
const SIGNING_KEY_KSUID_RESOURCE = "signingkey";
/** The hours the keys screen counts, the current one included. */
const USAGE_WINDOW_HOURS = 24;

/** `randomInt` draws each character without the bias a byte modulo 62 carries. */
function randomBase62({ length }: { length: number }): string {
  return Array.from({ length }, () => BASE62[randomInt(BASE62.length)]).join("");
}

/**
 * A project's braid signing keys (ADR-183 §4): issued, rotated with an overlap, revoked, listed
 * with 24 hours of counts. The permission and plan are asked at the door; the project's
 * organisation names every read, so a key of another project reads as not found.
 */
export class SigningKeyService {
  private readonly keys: SigningKeyRepository;
  private readonly usage: SigningKeyUsageRepository;
  private readonly projects: Pick<ProjectApi, "getOrganizationId">;
  private readonly braidSignatures: Pick<BraidSignatureVerificationService, "forget">;
  private readonly now: () => Instant;

  private constructor(deps: {
    keys: SigningKeyRepository;
    usage: SigningKeyUsageRepository;
    projects: Pick<ProjectApi, "getOrganizationId">;
    braidSignatures: Pick<BraidSignatureVerificationService, "forget">;
    now: () => Instant;
  }) {
    this.keys = deps.keys;
    this.usage = deps.usage;
    this.projects = deps.projects;
    this.braidSignatures = deps.braidSignatures;
    this.now = deps.now;
  }

  static create(input: {
    keys: SigningKeyRepository;
    usage: SigningKeyUsageRepository;
    projects: Pick<ProjectApi, "getOrganizationId">;
    braidSignatures: Pick<BraidSignatureVerificationService, "forget">;
    now?: () => Instant;
  }): SigningKeyService {
    return new SigningKeyService({ ...input, now: input.now ?? nowInstant });
  }

  async find({ projectId }: { projectId: string }): Promise<SigningKey[]> {
    const organizationId = await this.projects.getOrganizationId(projectId);
    return this.listed({ rows: await this.keys.findByProject({ organizationId, projectId }) });
  }

  async create(input: {
    projectId: string;
    name: string;
    userId: string;
  }): Promise<IssuedSigningKey> {
    const organizationId = await this.projects.getOrganizationId(input.projectId);
    return this.issue({ ...input, organizationId });
  }

  async rotate(input: {
    projectId: string;
    keyId: string;
    userId: string;
  }): Promise<IssuedSigningKey> {
    const { projectId, keyId } = input;
    const organizationId = await this.projects.getOrganizationId(projectId);
    const current = await this.keys.getById({ organizationId, projectId, id: keyId });
    if (current.rotatedAt !== null || current.revokedAt !== null) {
      throw new SigningKeyNotFoundError(keyId);
    }
    const at = this.now();
    // Marked first, so of two rotations at once only one issues a key.
    const marked = await this.keys.markRotated({
      organizationId,
      projectId,
      id: keyId,
      rotatedAt: at,
      verifiesUntil: at.add({ milliseconds: SIGNING_KEY_ROTATION_OVERLAP_MS }),
    });
    if (!marked) throw new SigningKeyNotFoundError(keyId);
    this.braidSignatures.forget({ organizationId, publicId: current.publicId });
    return this.issue({ organizationId, projectId, name: current.name, userId: input.userId });
  }

  async revoke({ projectId, keyId }: { projectId: string; keyId: string }): Promise<SigningKey> {
    const organizationId = await this.projects.getOrganizationId(projectId);
    await this.keys.revoke({ organizationId, projectId, id: keyId, revokedAt: this.now() });
    const row = await this.keys.getById({ organizationId, projectId, id: keyId });
    this.braidSignatures.forget({ organizationId, publicId: row.publicId });
    const [revoked] = await this.listed({ rows: [row] });
    return revoked!;
  }

  private async issue(input: {
    organizationId: string;
    projectId: string;
    name: string;
    userId: string;
  }): Promise<IssuedSigningKey> {
    const publicId = randomBase62({ length: PUBLIC_ID_LENGTH });
    const secret = randomBase62({ length: SECRET_LENGTH });
    const row = await this.keys.create({
      id: generate(SIGNING_KEY_KSUID_RESOURCE).toString(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: input.name,
      publicId,
      secret,
      createdByUserId: input.userId,
    });
    const at = this.now().epochMilliseconds;
    return {
      signingKey: SigningKeyService.listItem({ row, at, passed: 0, failed: 0 }),
      secret: `${SIGNING_KEY_PREFIX}${publicId}_${secret}`,
    };
  }

  private async listed({ rows }: { rows: readonly SigningKeyRow[] }): Promise<SigningKey[]> {
    if (rows.length === 0) return [];
    const at = this.now().epochMilliseconds;
    const toHour = signingKeyUsageHourOf({ at });
    const totals = await this.usage.findTotals({
      keyIds: rows.map((row) => row.id),
      fromHour: toHour - USAGE_WINDOW_HOURS + 1,
      toHour,
    });
    const byKey = new Map(totals.map((total) => [total.keyId, total]));
    return rows.map((row) =>
      SigningKeyService.listItem({
        row,
        at,
        passed: byKey.get(row.id)?.passed ?? 0,
        failed: byKey.get(row.id)?.failed ?? 0,
      }),
    );
  }

  private static listItem({
    row,
    at,
    passed,
    failed,
  }: {
    row: SigningKeyRow;
    at: number;
    passed: number;
    failed: number;
  }): SigningKey {
    return {
      id: row.id,
      name: row.name,
      publicId: row.publicId,
      projectId: row.projectId,
      status: signingKeyStatusOf({ key: row, at }),
      createdAt: toDate(row.createdAt),
      createdByUserId: row.createdByUserId,
      lastUsedAt: row.lastUsedAt && toDate(row.lastUsedAt),
      verifiesUntil: row.verifiesUntil && toDate(row.verifiesUntil),
      revokedAt: row.revokedAt && toDate(row.revokedAt),
      passed24h: passed,
      failed24h: failed,
    };
  }
}
