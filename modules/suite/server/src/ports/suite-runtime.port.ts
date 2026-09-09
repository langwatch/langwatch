import type { Projection, ProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";

export type SuiteEventingCapabilities = {
  suiteRunState: ProjectionStore<Projection<SuiteRunStateData>>;
};

/** The run projection a process composing the suite feature folds into. */
export abstract class SuiteRuntimePort {
  abstract eventing(): SuiteEventingCapabilities;
}
