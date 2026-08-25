import type { SuiteService } from "@langwatch/suite-contract";
import {
  ClickHouseSuiteEventingAdapter,
  PostgresSuiteAdapter,
  type PostgresSuiteAdapterOptions,
  type SuiteEventingCapabilities,
} from "@langwatch/suite-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

type AppSuiteRuntimeOptions = Omit<PostgresSuiteAdapterOptions, "database"> & {
  database: PrismaClient;
};

export class AppSuiteRuntime {
  static create(options: AppSuiteRuntimeOptions): AppSuiteRuntime {
    return new AppSuiteRuntime(options);
  }

  static eventingForReplay(options: {
    resolveClient: NonNullable<
      PostgresSuiteAdapterOptions["resolveClickHouseClient"]
    >;
    defaultRetentionDays: number;
  }): SuiteEventingCapabilities {
    return ClickHouseSuiteEventingAdapter.create(options).build();
  }

  private readonly adapter: PostgresSuiteAdapter;

  private constructor(options: AppSuiteRuntimeOptions) {
    this.adapter = PostgresSuiteAdapter.create(options);
  }

  build(): SuiteService {
    return this.adapter.build();
  }

  eventing(): SuiteEventingCapabilities {
    return this.adapter.eventing();
  }
}
