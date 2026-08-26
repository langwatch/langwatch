import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type {
  TraceCanonicalisationService as TraceCanonicalisationServiceContract,
  TraceService,
} from "@langwatch/trace-contract";
import {
  ClickHouseTraceAdapter,
  TraceCanonicalisationService,
  type TraceQueryFieldValuesPort,
  type TraceClickHouseResolver,
} from "@langwatch/trace-server";

export type AppTraceRuntimeOptions = {
  resolveClient: TraceClickHouseResolver;
  modelProviders: ModelProviderService;
  queryFieldValues: TraceQueryFieldValuesPort;
};

/** App composition for the process-owned Trace service. */
export class AppTraceRuntime {
  private constructor(private readonly options: AppTraceRuntimeOptions) {}

  static create(options: AppTraceRuntimeOptions): AppTraceRuntime {
    return new AppTraceRuntime(options);
  }

  static createNull(modelProviders: ModelProviderService): TraceService {
    return ClickHouseTraceAdapter.createNull(modelProviders);
  }

  static createCanonicalisation(): TraceCanonicalisationServiceContract {
    return TraceCanonicalisationService.create();
  }

  build(): TraceService {
    return ClickHouseTraceAdapter.create(this.options).build();
  }
}
