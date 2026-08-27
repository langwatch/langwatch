import type { SuiteService } from "@langwatch/suite-contract";
import {
  ClickHouseSuiteEventingAdapter,
  type SuiteEventingCapabilities,
  type SuiteRuntimeAdapter,
} from "@langwatch/suite-server";
import type { SuiteClickHouseClient } from "@langwatch/suite-server";

export class AppSuiteRuntime {
  static create(adapter: SuiteRuntimeAdapter): AppSuiteRuntime {
    return new AppSuiteRuntime(adapter);
  }

  static eventingForReplay(options: {
    resolveClient: (projectId: string) => Promise<SuiteClickHouseClient>;
    defaultRetentionDays: number;
  }): SuiteEventingCapabilities {
    return ClickHouseSuiteEventingAdapter.create(options).build();
  }

  private constructor(private readonly adapter: SuiteRuntimeAdapter) {}

  build(): SuiteService {
    return this.adapter.build();
  }

  eventing(): SuiteEventingCapabilities {
    return this.adapter.eventing();
  }
}
