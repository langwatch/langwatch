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
  analytics: ["clickhouse", "rateLimiter"],
  annotation: [],
  "api-key": [],
  auth: ["logger", "prisma", "rateLimiter", "redis"],
  authz: ["prisma", "redis"],
  automation: ["encryption", "logger", "prisma", "redis"],
  billing: [],
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
  governance: [],
  "hosted-mcp": [],
  identity: ["eventing", "prisma"],
  langy: ["eventing", "prisma", "rateLimiter", "redis"],
  licensing: [],
  log: [],
  "managed-provider": [],
  metric: [],
  "model-provider": ["redis"],
  monitor: [],
  notification: [],
  ops: ["clickhouse", "eventing", "logger", "prisma", "redis"],
  organization: ["encryption", "logger", "prisma", "redis"],
  "platform-health": [],
  presence: [],
  project: ["encryption", "logger"],
  prompt: ["logger", "prisma", "rateLimiter"],
  role: [],
  scenario: ["encryption", "rateLimiter"],
  scim: ["prisma"],
  secret: ["encryption"],
  share: ["redis"],
  sso: [],
  "stored-object": ["clickhouse", "logger", "prisma"],
  suite: ["clickhouse"],
  topic: ["prisma"],
  trace: ["clickhouse", "eventing", "logger", "rateLimiter", "redis"],
  user: ["prisma", "redis"],
  webhook: ["prisma", "rateLimiter"],
  workflow: ["encryption", "prisma"],
} as const;
