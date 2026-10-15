import { nowInstant, type Instant } from "@langwatch/time";

import type {
  TestingLicenseTokenDraft,
  TestingLicenseTokenRecord,
  TestingLicenseTokenRepository,
} from "../testing-license-token.repository.ts";

type StoredToken = TestingLicenseTokenRecord & { tokenHash: string };

/** Testing-licence tokens in memory; `revoke` answers false where the conditional write would. */
export class MemoryTestingLicenseTokenRepository implements TestingLicenseTokenRepository {
  static create({ now }: { now?: () => Instant } = {}): MemoryTestingLicenseTokenRepository {
    return new MemoryTestingLicenseTokenRepository(now ?? nowInstant);
  }

  readonly #rows = new Map<string, StoredToken>();

  private constructor(private readonly now: () => Instant) {}

  async create(draft: TestingLicenseTokenDraft): Promise<TestingLicenseTokenRecord> {
    const row: StoredToken = {
      ...draft,
      revokedAt: null,
      revokedById: null,
      lastUsedAt: null,
      createdAt: this.now(),
    };
    this.#rows.set(row.id, row);
    return view(row);
  }

  async findByTokenHash(tokenHash: string): Promise<TestingLicenseTokenRecord[]> {
    return [...this.#rows.values()].filter((row) => row.tokenHash === tokenHash).map(view);
  }

  async findById(id: string): Promise<TestingLicenseTokenRecord[]> {
    const row = this.#rows.get(id);
    return row ? [view(row)] : [];
  }

  async listAll({
    page,
    pageSize,
  }: {
    page: number;
    pageSize: number;
  }): Promise<{ rows: TestingLicenseTokenRecord[]; total: number }> {
    const newestFirst = [...this.#rows.values()].toReversed();
    return {
      rows: newestFirst.slice(page * pageSize, page * pageSize + pageSize).map(view),
      total: newestFirst.length,
    };
  }

  async revoke({
    id,
    at,
    revokedById,
  }: {
    id: string;
    at: Instant;
    revokedById: string;
  }): Promise<boolean> {
    const row = this.#rows.get(id);
    if (!row || row.revokedAt) return false;
    row.revokedAt = at;
    row.revokedById = revokedById;
    return true;
  }

  async recordUse({ id, at }: { id: string; at: Instant }): Promise<void> {
    const row = this.#rows.get(id);
    if (row) row.lastUsedAt = at;
  }
}

function view({ tokenHash: _tokenHash, ...record }: StoredToken): TestingLicenseTokenRecord {
  return { ...record };
}
