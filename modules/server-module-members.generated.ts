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
  "coding-agent": [],
  dashboard: [],
  "data-privacy": ["dataPrivacy"],
  "data-retention": ["clickhouse"],
  dataset: [],
  entitlement: ["logger"],
  evaluation: [],
  evaluator: ["prisma"],
  experiment: ["clickhouse", "logger", "prisma"],
  "feature-flag": [],
  gateway: ["clickhouse", "elevenLabsWebhook", "gatewayInternalProtocol", "prisma"],
  github: ["redis"],
  "hosted-mcp": [],
  identity: ["eventing", "prisma"],
  langy: ["eventing", "prisma", "rateLimiter", "redis"],
  log: [],
  metric: [],
  "model-provider": ["redis"],
  monitor: ["monitor"],
  notification: [],
  ops: ["clickhouse", "eventing", "logger", "prisma", "redis"],
  organization: ["encryption", "logger", "prisma", "redis"],
  "platform-health": [],
  presence: ["logger", "redis"],
  project: ["encryption", "logger", "topicClustering"],
  prompt: ["logger", "prisma", "rateLimiter"],
  role: ["prisma"],
  scenario: ["encryption", "rateLimiter"],
  secret: ["encryption"],
  share: ["redis"],
  "stored-object": ["clickhouse", "logger", "prisma"],
  suite: ["clickhouse"],
  topic: ["prisma"],
  trace: ["clickhouse", "eventing", "logger", "rateLimiter", "redis"],
  user: ["prisma", "redis"],
  workflow: ["encryption", "prisma"],
  billing: [],
  governance: ["prisma"],
  licensing: ["authProviderIsMounted", "checkLimit", "configuredAuthProvider", "notifyLimitReached", "platformSsoAllowed", "reportError", "reportSigningFailure", "repository", "retention", "usage"],
  "managed-provider": [],
  scim: ["prisma"],
  sso: ["logger"],
  webhook: ["prisma", "rateLimiter"],
} as const;
