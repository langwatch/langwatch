import type { Projection, ProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";

export type SuiteEventingCapabilities = {
  suiteRunState: ProjectionStore<Projection<SuiteRunStateData>>;
};
