import type { Projection, ProjectionStore } from "@langwatch/eventing";
import type { SuiteService, SuiteRunStateData } from "@langwatch/suite-contract";

export type SuiteEventingCapabilities = {
  suiteRunState: ProjectionStore<Projection<SuiteRunStateData>>;
};

/** What a process composing the suite feature hands its callers. */
export abstract class SuiteRuntimePort {
  abstract build(): SuiteService;
  abstract eventing(): SuiteEventingCapabilities;
}
