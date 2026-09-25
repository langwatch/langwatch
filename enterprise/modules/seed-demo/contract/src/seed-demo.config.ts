// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/** Main's gate: the comma-separated organizations the seeding may touch; absent everywhere but the demo instance. */
export const seedDemoConfig = Config.define((c) => ({
  demoOrgIds: c.env("DEMO_ORG_IDS", z.string().optional()),
}));

export type SeedDemoConfig = ConfigOf<typeof seedDemoConfig>;
