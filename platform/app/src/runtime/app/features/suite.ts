import type { SuiteService } from "@langwatch/suite-contract";
import {
  PostgresSuiteAdapter,
  type PostgresSuiteAdapterOptions,
} from "@langwatch/suite-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

type AppSuiteRuntimeOptions = Omit<PostgresSuiteAdapterOptions, "database"> & {
  database: PrismaClient;
};

export class AppSuiteRuntime {
  static create(options: AppSuiteRuntimeOptions): AppSuiteRuntime {
    return new AppSuiteRuntime(options);
  }

  private constructor(
    private readonly options: AppSuiteRuntimeOptions,
  ) {}

  build(): SuiteService {
    return PostgresSuiteAdapter.create(this.options);
  }
}
