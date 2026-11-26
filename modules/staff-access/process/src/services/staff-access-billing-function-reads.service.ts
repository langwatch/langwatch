import type { STAFF_ACCESS_BILLING_FUNCTIONS } from "@langwatch/staff-access-contract";

import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

type BillingReadsDeps = Readonly<{}>;

/** The billing ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessBillingFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_BILLING_FUNCTIONS>;

  private constructor(private readonly deps: BillingReadsDeps) {
    this.reads = {};
  }

  static create(deps: BillingReadsDeps): StaffAccessBillingFunctionReadsService {
    return new StaffAccessBillingFunctionReadsService(deps);
  }
}
