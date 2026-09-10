import {
  type OrganizationDataplane,
  OrganizationDataplanePort,
} from "../app/ops.app.ts";

/**
 * The dataplane answer, read off the ClickHouse routing table the deployment's
 * environment states.
 *
 * It takes the routes rather than the whole table, so this feature needs no
 * dependency on the ClickHouse client for one map. An organization the map
 * does not name is on the shared instance, the router's own fallback.
 */
export class RoutingTableOrganizationDataplaneAdapter implements OrganizationDataplanePort {
  static create({
    routes,
  }: {
    routes: ReadonlyMap<string, string>;
  }): RoutingTableOrganizationDataplaneAdapter {
    return new RoutingTableOrganizationDataplaneAdapter(routes);
  }

  private constructor(private readonly routes: ReadonlyMap<string, string>) {
  }

  dataplaneFor(organizationId: string): OrganizationDataplane {
    const endpoint = this.routes.get(organizationId);
    return endpoint === undefined ? { kind: "shared" } : { kind: "private", endpoint };
  }
}
