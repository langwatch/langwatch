// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi } from "@langwatch/kernel/module-api";

import type { SeedDemoRunInput, SeedRunReport } from "./seed-demo-report.ts";

/** The demo instance's seeding: one run over an allowlisted demo organization. */
export interface SeedDemoApi {
  runSeedDemo(input: SeedDemoRunInput): Promise<SeedRunReport>;
}

export const SeedDemoApi = moduleApi<SeedDemoApi>()("seed-demo");
