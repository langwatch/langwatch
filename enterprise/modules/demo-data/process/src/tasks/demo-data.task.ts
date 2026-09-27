// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DemoDataApi } from "@langwatch/enterprise-demo-data-contract";
import { Task } from "@langwatch/task";

import { parseDemoDataArgs } from "../rules/demo-data-args.rules.ts";
import { reportHasFailures } from "../rules/seed-run-report.rules.ts";

/** Main's `seed-demo.ts` CLI: a dry run unless `--execute`, against `--org-id` or the first allowlisted organization. */
export class DemoDataTask extends Task {
  readonly name = "demo-data";
  readonly description = "Seeds the allowlisted demo organization; dry run unless --execute.";

  private constructor(private readonly seeds: Pick<DemoDataApi, "runSeedDemo">) {
    super();
  }

  static create({ seeds }: { seeds: Pick<DemoDataApi, "runSeedDemo"> }): DemoDataTask {
    return new DemoDataTask(seeds);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const report = await this.seeds.runSeedDemo(parseDemoDataArgs(args));
    if (reportHasFailures(report)) throw new Error("demo seed run had failures");
  }
}
