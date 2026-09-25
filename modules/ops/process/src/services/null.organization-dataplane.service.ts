import { type OrganizationDataplane, type OrganizationDataplaneResolver } from "../app/ops.app.ts";

/** Every organization on the shared instance — a deployment with no private routes. */
export class NullOrganizationDataplaneService implements OrganizationDataplaneResolver {
  private constructor() {}

  static create(): NullOrganizationDataplaneService {
    return new NullOrganizationDataplaneService();
  }

  dataplaneFor(): OrganizationDataplane {
    return { kind: "shared" };
  }
}
