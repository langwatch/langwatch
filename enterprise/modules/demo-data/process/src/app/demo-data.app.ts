// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  DemoDataApi,
  demoDataConfig,
  type DemoDataApi as DemoDataApiContract,
  type DemoDataConfig,
  type DemoDataRunInput,
  type SeedRunReport,
} from "@langwatch/enterprise-demo-data-contract";
import type { Event, StaticPipelineDefinition } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { nowInstant } from "@langwatch/time";

import { buildDemoDataPipeline } from "../eventing/demo-data.pipeline.ts";
import { DemoDataService } from "../services/demo-data.service.ts";

const DEMO_DATA_READS = reads("logger");

type DemoDataSetup = FeatureSetup<
  typeof DemoDataApp.dependencies,
  MembersRead<typeof DEMO_DATA_READS>,
  DemoDataConfig | undefined
>;

export class DemoDataApp implements DemoDataApiContract {
  static readonly contract = DemoDataApi;
  static readonly dependencies = {
    /** The demo organization's name and slug, which the first action verifies. */
    organizations: OrganizationApi,
  };
  static readonly config = demoDataConfig;
  static readonly reads = DEMO_DATA_READS;

  readonly #seeds: DemoDataService;

  private constructor(seeds: DemoDataService) {
    this.#seeds = seeds;
  }

  static create({ dependencies, members, config }: DemoDataSetup): DemoDataApp {
    return new DemoDataApp(
      DemoDataService.create({
        organizations: dependencies.organizations,
        demoOrgIds: config?.demoOrgIds,
        logger: members.logger,
        now: () => nowInstant(),
      }),
    );
  }

  runSeedDemo(input: DemoDataRunInput): Promise<SeedRunReport> {
    return this.#seeds.run(input);
  }

  demoDataPipeline(deps: {
    deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  }): StaticPipelineDefinition<Event> {
    return buildDemoDataPipeline({
      run: () => this.#seeds.runScheduled(),
      deleteDispatchedBefore: deps.deleteDispatchedBefore,
    });
  }
}
