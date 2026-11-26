import type { STAFF_ACCESS_PLATFORM_FUNCTIONS } from "@langwatch/staff-access-contract";

import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

type PlatformReadsDeps = Readonly<{}>;

/** The platform ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessPlatformFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_PLATFORM_FUNCTIONS>;

  private constructor(private readonly deps: PlatformReadsDeps) {
    this.reads = {};
  }

  static create(deps: PlatformReadsDeps): StaffAccessPlatformFunctionReadsService {
    return new StaffAccessPlatformFunctionReadsService(deps);
  }
}
