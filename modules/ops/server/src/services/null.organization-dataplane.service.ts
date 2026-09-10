import {
  type OrganizationDataplane,
  OrganizationDataplaneResolver,
} from "../app/ops.app.ts";

/** Every organization on the shared instance — a deployment with no private routes. */
export class NullOrganizationDataplaneAdapter implements OrganizationDataplaneResolver {
  static create(): NullOrganizationDataplaneAdapter {
    return new NullOrganizationDataplaneAdapter();
  }

  dataplaneFor(): OrganizationDataplane {
    return { kind: "shared" };
  }
}
