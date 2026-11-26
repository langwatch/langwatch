import type { STAFF_ACCESS_PEOPLE_FUNCTIONS } from "@langwatch/staff-access-contract";

import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

type PeopleReadsDeps = Readonly<{}>;

/** The people ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessPeopleFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_PEOPLE_FUNCTIONS>;

  private constructor(private readonly deps: PeopleReadsDeps) {
    this.reads = {};
  }

  static create(deps: PeopleReadsDeps): StaffAccessPeopleFunctionReadsService {
    return new StaffAccessPeopleFunctionReadsService(deps);
  }
}
