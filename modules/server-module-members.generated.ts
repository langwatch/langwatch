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
  analytics: [],
  annotation: [],
  "api-key": [],
  auth: [],
  authz: ["prisma", "redis"],
  automation: [],
  "coding-agent": [],
  dashboard: [],
  "data-privacy": [],
  "data-retention": ["clickhouse"],
  dataset: [],
  entitlement: [],
  evaluation: [],
  evaluator: [],
  experiment: [],
  "feature-flag": [],
  gateway: [],
  github: [],
  "hosted-mcp": [],
  identity: ["eventing", "prisma"],
  langy: [],
  log: [],
  metric: [],
  "model-provider": [],
  monitor: [],
  notification: [],
  ops: ["clickhouse", "eventing", "logger", "prisma", "redis"],
  organization: ["encryption", "logger", "prisma"],
  "platform-health": [],
  presence: [],
  project: [],
  prompt: [],
  role: [],
  scenario: [],
  secret: ["encryption"],
  share: ["redis"],
  "stored-object": ["clickhouse", "logger", "prisma"],
  suite: ["clickhouse"],
  topic: [],
  trace: [],
  user: [],
  webhook: [],
  workflow: [],
} as const;
