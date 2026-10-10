import { type OrganizationDataplane, type OrganizationDataplaneResolver } from "../app/ops.app.ts";

/**
 * The dataplane answer, read off the ClickHouse routing table. Takes the
 * routes rather than the whole table, needing no ClickHouse client
 * dependency; an unnamed organization falls back to the shared instance.
 */
export class RoutingTableOrganizationDataplaneService implements OrganizationDataplaneResolver {
  static create({
    routes,
  }: {
    routes: ReadonlyMap<string, string>;
  }): RoutingTableOrganizationDataplaneService {
    return new RoutingTableOrganizationDataplaneService(routes);
  }

  private constructor(private readonly routes: ReadonlyMap<string, string>) {}

  dataplaneFor(organizationId: string): OrganizationDataplane {
    const endpoint = this.routes.get(organizationId);
    return endpoint === undefined ? { kind: "shared" } : { kind: "private", endpoint };
  }
}
