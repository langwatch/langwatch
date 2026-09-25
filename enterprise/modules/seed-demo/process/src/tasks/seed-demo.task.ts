// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SeedDemoApi } from "@langwatch/enterprise-seed-demo-contract";
import { Task } from "@langwatch/task";

import { parseSeedDemoArgs } from "../rules/seed-demo-args.rules.ts";
import { reportHasFailures } from "../rules/seed-run-report.rules.ts";

/** Main's `seed-demo.ts` CLI: a dry run unless `--execute`, against `--org-id` or the first allowlisted organization. */
export class SeedDemoTask extends Task {
  readonly name = "seed-demo";
  readonly description = "Seeds the allowlisted demo organization; dry run unless --execute.";

  private constructor(private readonly seeds: Pick<SeedDemoApi, "runSeedDemo">) {
    super();
  }

  static create({ seeds }: { seeds: Pick<SeedDemoApi, "runSeedDemo"> }): SeedDemoTask {
    return new SeedDemoTask(seeds);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const report = await this.seeds.runSeedDemo(parseSeedDemoArgs(args));
    if (reportHasFailures(report)) throw new Error("demo seed run had failures");
  }
}
