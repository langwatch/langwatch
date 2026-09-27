// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi } from "@langwatch/kernel/module-api";

import type { DemoDataRunInput, SeedRunReport } from "./demo-data-report.ts";

/** The demo instance's seeding: one run over an allowlisted demo organization. */
export interface DemoDataApi {
  runSeedDemo(input: DemoDataRunInput): Promise<SeedRunReport>;
}

export const DemoDataApi = moduleApi<DemoDataApi>()("demo-data");
