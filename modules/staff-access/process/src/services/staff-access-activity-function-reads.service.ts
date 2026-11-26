import type { STAFF_ACCESS_ACTIVITY_FUNCTIONS } from "@langwatch/staff-access-contract";

import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

type ActivityReadsDeps = Readonly<{}>;

/** The activity ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessActivityFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_ACTIVITY_FUNCTIONS>;

  private constructor(private readonly deps: ActivityReadsDeps) {
    this.reads = {};
  }

  static create(deps: ActivityReadsDeps): StaffAccessActivityFunctionReadsService {
    return new StaffAccessActivityFunctionReadsService(deps);
  }
}
