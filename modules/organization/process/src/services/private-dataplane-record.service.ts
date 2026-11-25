import type { OrganizationRepository } from "../repositories/organization.repository.ts";
import type { PrivateClickHouseRoutesRepository } from "../repositories/private-clickhouse-routes.repository.ts";
import type { PrivateS3AccountsRepository } from "../repositories/private-s3-accounts.repository.ts";

type SeenLabels = { clickhouseLabel: string | null; s3Label: string | null };

/**
 * Records each organization this deployment routes to its own ClickHouse or S3, the first time
 * it is seen, so the stores refuse it later if the route goes missing rather than serve it from
 * the shared ones. Spec: specs/private-dataplane/clickhouse-routing.feature.
 */
export class PrivateDataplaneRecordService {
  static create({
    routes,
    accounts,
    organizations,
  }: {
    routes: PrivateClickHouseRoutesRepository;
    accounts: PrivateS3AccountsRepository;
    organizations: Pick<OrganizationRepository, "recordPrivateDataplaneSeen">;
  }): PrivateDataplaneRecordService {
    return new PrivateDataplaneRecordService(routes, accounts, organizations);
  }

  private constructor(
    private readonly routes: PrivateClickHouseRoutesRepository,
    private readonly accounts: PrivateS3AccountsRepository,
    private readonly organizations: Pick<OrganizationRepository, "recordPrivateDataplaneSeen">,
  ) {}

  /** Records every usable private route seen; a malformed one is refused by the stores anyway. */
  async recordSeen(): Promise<{ organizations: number }> {
    const seen = new Map<string, SeenLabels>();
    const labelsOf = (organizationId: string): SeenLabels => {
      const known = seen.get(organizationId) ?? { clickhouseLabel: null, s3Label: null };
      seen.set(organizationId, known);
      return known;
    };
    for (const route of this.routes.findRouteVariables()) {
      if (route.state === "present") labelsOf(route.organizationId).clickhouseLabel = route.label;
    }
    for (const account of this.accounts.findAccountVariables()) {
      if (account.state === "present") labelsOf(account.organizationId).s3Label = account.label;
    }

    for (const [organizationId, labels] of seen) {
      await this.organizations.recordPrivateDataplaneSeen({ organizationId, ...labels });
    }
    return { organizations: seen.size };
  }
}
