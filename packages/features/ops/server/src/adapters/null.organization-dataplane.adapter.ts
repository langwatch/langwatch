import {
  type OrganizationDataplane,
  OrganizationDataplanePort,
} from "../ports/organization-dataplane.port";

/** Every organization on the shared instance — a deployment with no private routes. */
export class NullOrganizationDataplaneAdapter extends OrganizationDataplanePort {
  static create(): NullOrganizationDataplaneAdapter {
    return new NullOrganizationDataplaneAdapter();
  }

  dataplaneFor(): OrganizationDataplane {
    return { kind: "shared" };
  }
}
