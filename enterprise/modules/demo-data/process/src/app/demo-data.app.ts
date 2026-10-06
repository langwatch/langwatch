// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  DemoDataApi,
  demoDataConfig,
  type DemoDataApi as DemoDataApiContract,
  type DemoDataConfig,
  type DemoDataRunInput,
  type SeedRunReport,
} from "@langwatch/enterprise-demo-data-contract";
import type { StaticPipelineDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { nowInstant } from "@langwatch/time";

import { buildDemoDataPipeline } from "../eventing/demo-data.pipeline.ts";
import { DemoDataService } from "../services/demo-data.service.ts";

const logger = createLogger("langwatch:demo-data");

type DemoDataSetup = FeatureSetup<
  typeof DemoDataModule.dependencies,
  never,
  DemoDataConfig | undefined
>;

export class DemoDataModule implements DemoDataApiContract {
  static readonly contract = DemoDataApi;
  static readonly dependencies = {
    /** The demo organization's name and slug, which the first action verifies. */
    organizations: OrganizationApi,
  };
  static readonly config = demoDataConfig;

  readonly #seeds: DemoDataService;

  private constructor(seeds: DemoDataService) {
    this.#seeds = seeds;
  }

  static create({ dependencies, config }: DemoDataSetup): DemoDataModule {
    return new DemoDataModule(
      DemoDataService.create({
        organizations: dependencies.organizations,
        demoOrgIds: config?.demoOrgIds,
        logger,
        now: () => nowInstant(),
      }),
    );
  }

  runSeedDemo(input: DemoDataRunInput): Promise<SeedRunReport> {
    return this.#seeds.run(input);
  }

  demoDataPipeline(deps: {
    deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  }): StaticPipelineDefinition<never> {
    return buildDemoDataPipeline({
      run: () => this.#seeds.runScheduled(),
      deleteDispatchedBefore: deps.deleteDispatchedBefore,
    });
  }
}
