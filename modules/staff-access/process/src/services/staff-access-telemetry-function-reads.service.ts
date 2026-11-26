import type { STAFF_ACCESS_TELEMETRY_FUNCTIONS } from "@langwatch/staff-access-contract";

import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

type TelemetryReadsDeps = Readonly<{}>;

/** The telemetry ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessTelemetryFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_TELEMETRY_FUNCTIONS>;

  private constructor(private readonly deps: TelemetryReadsDeps) {
    this.reads = {};
  }

  static create(deps: TelemetryReadsDeps): StaffAccessTelemetryFunctionReadsService {
    return new StaffAccessTelemetryFunctionReadsService(deps);
  }
}
