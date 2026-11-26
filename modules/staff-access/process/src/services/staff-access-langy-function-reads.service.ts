import type { STAFF_ACCESS_LANGY_FUNCTIONS } from "@langwatch/staff-access-contract";

import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

type LangyReadsDeps = Readonly<{}>;

/** The langy ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessLangyFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_LANGY_FUNCTIONS>;

  private constructor(private readonly deps: LangyReadsDeps) {
    this.reads = {};
  }

  static create(deps: LangyReadsDeps): StaffAccessLangyFunctionReadsService {
    return new StaffAccessLangyFunctionReadsService(deps);
  }
}
