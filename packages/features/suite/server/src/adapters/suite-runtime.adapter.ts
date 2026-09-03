import type { SuiteService } from "@langwatch/suite-contract";
import type { Projection, ProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";

export type SuiteEventingCapabilities = {
  suiteRunState: ProjectionStore<Projection<SuiteRunStateData>>;
};

export interface SuiteRuntimeAdapter {
  build(): SuiteService;
  eventing(): SuiteEventingCapabilities;
}
