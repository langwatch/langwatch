// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SeedDemoApi,
  seedDemoConfig,
  type SeedDemoApi as SeedDemoApiContract,
  type SeedDemoConfig,
  type SeedDemoRunInput,
  type SeedRunReport,
} from "@langwatch/enterprise-seed-demo-contract";
import type { Event, StaticPipelineDefinition } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { nowInstant } from "@langwatch/time";

import { buildSeedDemoPipeline } from "../eventing/seed-demo.pipeline.ts";
import { SeedDemoService } from "../services/seed-demo.service.ts";

const SEED_DEMO_READS = reads("logger");

type SeedDemoSetup = FeatureSetup<
  typeof SeedDemoApp.dependencies,
  MembersRead<typeof SEED_DEMO_READS>,
  SeedDemoConfig | undefined
>;

export class SeedDemoApp implements SeedDemoApiContract {
  static readonly contract = SeedDemoApi;
  static readonly dependencies = {
    /** The demo organization's name and slug, which the first action verifies. */
    organizations: OrganizationApi,
  };
  static readonly config = seedDemoConfig;
  static readonly reads = SEED_DEMO_READS;

  readonly #seeds: SeedDemoService;

  private constructor(seeds: SeedDemoService) {
    this.#seeds = seeds;
  }

  static create({ dependencies, members, config }: SeedDemoSetup): SeedDemoApp {
    return new SeedDemoApp(
      SeedDemoService.create({
        organizations: dependencies.organizations,
        demoOrgIds: config?.demoOrgIds,
        logger: members.logger,
        now: () => nowInstant(),
      }),
    );
  }

  runSeedDemo(input: SeedDemoRunInput): Promise<SeedRunReport> {
    return this.#seeds.run(input);
  }

  seedDemoPipeline(deps: {
    deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  }): StaticPipelineDefinition<Event> {
    return buildSeedDemoPipeline({
      run: () => this.#seeds.runScheduled(),
      deleteDispatchedBefore: deps.deleteDispatchedBefore,
    });
  }
}
