import { SigningKeyNotFoundError } from "@langwatch/api-key-contract";
import { type PrismaModelClient, prismaTables } from "@langwatch/prisma-client";
import type { SharedCredentialCipher } from "@langwatch/secrets/shared-credential";
import { fromDate, type Instant, toDate } from "@langwatch/time";

import type {
  SigningKeyCreateRecord,
  SigningKeyCredential,
  SigningKeyRepository,
  SigningKeyRow,
} from "../signing-key.repository.ts";

export type SigningKeyDatabase = PrismaModelClient<"SigningKey">;

/** Every column but the sealed secret: no list or row read ever selects it. */
const rowSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  name: true,
  publicId: true,
  createdByUserId: true,
  createdAt: true,
  rotatedAt: true,
  verifiesUntil: true,
  revokedAt: true,
  lastUsedAt: true,
} as const;

type StoredRow = Omit<
  SigningKeyRow,
  "createdAt" | "rotatedAt" | "verifiesUntil" | "revokedAt" | "lastUsedAt"
> & {
  createdAt: Date;
  rotatedAt: Date | null;
  verifiesUntil: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

function rowOf(row: StoredRow): SigningKeyRow {
  return {
    ...row,
    createdAt: fromDate(row.createdAt),
    rotatedAt: row.rotatedAt ? fromDate(row.rotatedAt) : null,
    verifiesUntil: row.verifiesUntil ? fromDate(row.verifiesUntil) : null,
    revokedAt: row.revokedAt ? fromDate(row.revokedAt) : null,
    lastUsedAt: row.lastUsedAt ? fromDate(row.lastUsedAt) : null,
  };
}

/** Signing keys over Postgres, the secret sealed by the process cipher (ADR-201 §4). */
export class PrismaSigningKeyRepository implements SigningKeyRepository {
  static readonly tables = prismaTables("SigningKey");

  static create({
    prisma,
    cipher,
  }: {
    prisma: SigningKeyDatabase;
    cipher: SharedCredentialCipher;
  }): PrismaSigningKeyRepository {
    return new PrismaSigningKeyRepository(prisma, cipher);
  }

  private constructor(
    private readonly database: SigningKeyDatabase,
    private readonly cipher: SharedCredentialCipher,
  ) {}

  async findByProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<SigningKeyRow[]> {
    const rows = await this.database.signingKey.findMany({
      where: { organizationId: input.organizationId, projectId: input.projectId },
      select: rowSelect,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(rowOf);
  }

  async getById(input: {
    organizationId: string;
    projectId: string;
    id: string;
  }): Promise<SigningKeyRow> {
    const row = await this.database.signingKey.findFirst({
      where: { id: input.id, organizationId: input.organizationId, projectId: input.projectId },
      select: rowSelect,
    });
    if (!row) throw new SigningKeyNotFoundError(input.id);
    return rowOf(row);
  }

  async create(input: SigningKeyCreateRecord): Promise<SigningKeyRow> {
    const { secret, ...row } = input;
    return rowOf(
      await this.database.signingKey.create({
        data: { ...row, secretCiphertext: this.cipher.encrypt(secret) },
        select: rowSelect,
      }),
    );
  }

  async markRotated(input: {
    organizationId: string;
    projectId: string;
    id: string;
    rotatedAt: Instant;
    verifiesUntil: Instant;
  }): Promise<boolean> {
    const { count } = await this.database.signingKey.updateMany({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        rotatedAt: null,
        revokedAt: null,
      },
      data: { rotatedAt: toDate(input.rotatedAt), verifiesUntil: toDate(input.verifiesUntil) },
    });
    return count === 1;
  }

  async revoke(input: {
    organizationId: string;
    projectId: string;
    id: string;
    revokedAt: Instant;
  }): Promise<void> {
    const address = {
      id: input.id,
      organizationId: input.organizationId,
      projectId: input.projectId,
    };
    await this.database.signingKey.updateMany({
      where: { ...address, revokedAt: null },
      data: { revokedAt: toDate(input.revokedAt) },
    });
  }

  async findCredentials(input: {
    organizationId: string;
    at: Instant;
  }): Promise<SigningKeyCredential[]> {
    const rows = await this.database.signingKey.findMany({
      where: { organizationId: input.organizationId },
      select: {
        id: true,
        projectId: true,
        publicId: true,
        secretCiphertext: true,
        verifiesUntil: true,
        revokedAt: true,
      },
    });
    const at = toDate(input.at).getTime();
    return rows.map(({ secretCiphertext, verifiesUntil, revokedAt, ...row }) => {
      const verifies =
        revokedAt === null && (verifiesUntil === null || verifiesUntil.getTime() > at);
      const secret = verifies ? this.#opened(secretCiphertext) : null;
      return {
        ...row,
        verifiesUntil: verifiesUntil ? fromDate(verifiesUntil) : null,
        revokedAt: revokedAt ? fromDate(revokedAt) : null,
        secret: secret ?? null,
        unreadable: secret === undefined,
      };
    });
  }

  /** One key's secret opened; undefined when it will not open, so the others still verify. */
  #opened(ciphertext: string): string | undefined {
    try {
      return this.cipher.decrypt(ciphertext);
    } catch {
      return undefined;
    }
  }

  async markUsed(input: {
    organizationId: string;
    ids: readonly string[];
    at: Instant;
  }): Promise<void> {
    await this.database.signingKey.updateMany({
      where: { organizationId: input.organizationId, id: { in: [...input.ids] } },
      data: { lastUsedAt: toDate(input.at) },
    });
  }
}
