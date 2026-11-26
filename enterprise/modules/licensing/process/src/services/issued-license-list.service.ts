import type {
  IssuedLicenseFilters,
  IssuedLicensePage,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

import type {
  IssuedLicenseQuery,
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import { INTERNAL_LICENSE_EMAIL_SUFFIXES } from "../rules/issued-license.rules.ts";

/** How far a chain is followed each way; a renewal a year is decades of chain. */
const MAX_CHAIN = 100;

/** Reads the registry for the console: filtered pages with their counts, and reissue chains. */
export class IssuedLicenseListService {
  static create(options: {
    repository: IssuedLicenseRepository;
    now: () => Instant;
  }): IssuedLicenseListService {
    return new IssuedLicenseListService(options);
  }

  private constructor(
    private readonly options: { repository: IssuedLicenseRepository; now: () => Instant },
  ) {}

  async list({
    status,
    audience,
    page,
    pageSize,
    search,
  }: { page: number; pageSize: number; search?: string } & IssuedLicenseFilters): Promise<{
    rows: IssuedLicenseRecord[];
    total: number;
    counts: IssuedLicensePage["counts"];
  }> {
    const now = this.options.now();
    const byStatus = (active: boolean): IssuedLicenseQuery => ({ status: { at: now, active } });
    const byAudience = (internal: boolean): IssuedLicenseQuery => ({
      emailSuffixes: { suffixes: INTERNAL_LICENSE_EMAIL_SUFFIXES, matching: internal },
    });
    const statusPart = status ? byStatus(status === "active") : {};
    const audiencePart = audience ? byAudience(audience === "internal") : {};
    const { repository } = this.options;
    // A reissue chain lists and counts once, as its newest license.
    const heads: IssuedLicenseQuery = { search, chainHeadsOnly: true };
    // Each count keeps the other filter, so it says what choosing it would list.
    const [{ rows, total }, active, inactive, customer, internal, all] = await Promise.all([
      repository.listAll({ page, pageSize, ...heads, ...statusPart, ...audiencePart }),
      repository.countAll({ ...heads, ...audiencePart, ...byStatus(true) }),
      repository.countAll({ ...heads, ...audiencePart, ...byStatus(false) }),
      repository.countAll({ ...heads, ...statusPart, ...byAudience(false) }),
      repository.countAll({ ...heads, ...statusPart, ...byAudience(true) }),
      repository.countAll(heads),
    ]);
    return { rows, total, counts: { active, inactive, customer, internal, all } };
  }

  /** The licenses one reissue chain holds, newest first, followed both ways from `start`. */
  async findChain({ start }: { start: IssuedLicenseRecord }): Promise<IssuedLicenseRecord[]> {
    const { repository } = this.options;
    const older: IssuedLicenseRecord[] = [];
    for (let row = start; row.replacesId && older.length < MAX_CHAIN;) {
      const replaced = await repository.findById(row.replacesId);
      if (!replaced) break;
      older.push(replaced);
      row = replaced;
    }
    const newer: IssuedLicenseRecord[] = [];
    for (let row = start; newer.length < MAX_CHAIN;) {
      const replacement = await repository.findByReplacesId(row.id);
      if (!replacement) break;
      newer.unshift(replacement);
      row = replacement;
    }
    return [...newer, start, ...older];
  }
}
