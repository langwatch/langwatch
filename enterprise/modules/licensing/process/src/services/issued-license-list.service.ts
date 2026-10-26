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

/** Pages the registry for the console, with how many licenses each filter choice would list. */
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
    // Each count keeps the other filter, so it says what choosing it would list.
    const [{ rows, total }, active, inactive, customer, internal, all] = await Promise.all([
      repository.listAll({ page, pageSize, search, ...statusPart, ...audiencePart }),
      repository.countAll({ search, ...audiencePart, ...byStatus(true) }),
      repository.countAll({ search, ...audiencePart, ...byStatus(false) }),
      repository.countAll({ search, ...statusPart, ...byAudience(false) }),
      repository.countAll({ search, ...statusPart, ...byAudience(true) }),
      repository.countAll({ search }),
    ]);
    return { rows, total, counts: { active, inactive, customer, internal, all } };
  }
}
