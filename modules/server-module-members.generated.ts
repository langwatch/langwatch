/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

/**
 * What each installed module's App declared it reads, in name order.
 *
 * Boot builds exactly this union, plus whatever each module's chosen
 * repository tier requires, and refuses by module and member when this
 * process cannot supply one.
 */
export const serverModuleMembers = {
  agent: ["redis"],
  analytics: ["clickhouse"],
  annotation: [],
  "api-key": [],
  auth: ["logger", "prisma", "redis"],
  authz: ["prisma", "redis"],
  automation: ["encryption", "logger", "prisma", "redis"],
  "coding-agent": [],
  dashboard: [],
  "data-privacy": [],
  "data-retention": ["clickhouse"],
  dataset: [],
  entitlement: ["logger"],
  evaluation: [],
  evaluator: ["prisma"],
  experiment: ["clickhouse", "logger", "prisma"],
  "feature-flag": [],
  gateway: ["clickhouse", "prisma"],
  github: [],
  "hosted-mcp": [],
  identity: ["eventing", "prisma"],
  langy: ["eventing", "prisma", "redis"],
  log: [],
  metric: [],
  "model-provider": ["redis"],
  monitor: [],
  notification: [],
  ops: ["clickhouse", "eventing", "logger", "prisma", "redis"],
  organization: ["encryption", "logger", "prisma"],
  "platform-health": [],
  presence: [],
  project: [],
  prompt: ["logger", "prisma"],
  role: [],
  scenario: ["encryption"],
  secret: ["encryption"],
  share: ["redis"],
  "stored-object": ["clickhouse", "logger", "prisma"],
  suite: ["clickhouse"],
  topic: ["prisma"],
  trace: ["clickhouse", "eventing", "logger"],
  user: ["prisma", "redis"],
  webhook: ["prisma"],
  workflow: ["encryption", "prisma"],
} as const;
