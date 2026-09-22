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
  agent: ["publicBaseUrl", "redis"],
  analytics: ["clickhouse", "publicBaseUrl", "rateLimiter"],
  annotation: [],
  "api-key": [],
  auth: ["isSaas", "publicBaseUrl"],
  authz: ["prisma", "redis"],
  automation: ["encryption", "logger", "prisma", "publicBaseUrl", "redis", "secrets"],
  "coding-agent": [],
  dashboard: ["publicBaseUrl"],
  "data-privacy": ["dataPrivacy"],
  "data-retention": ["clickhouse", "nodeEnvironment"],
  dataset: ["content", "publicBaseUrl", "queue", "storage", "storageResolver"],
  entitlement: ["logger"],
  evaluation: [],
  evaluator: ["prisma", "publicBaseUrl"],
  experiment: ["clickhouse", "logger", "prisma", "redis"],
  "feature-flag": [],
  gateway: ["clickhouse", "elevenLabsWebhook", "gatewayInternalProtocol", "prisma"],
  github: ["redis", "secrets"],
  "hosted-mcp": ["encryption", "publicBaseUrl", "redis"],
  identity: ["eventing", "prisma"],
  "instant-eval": ["clickhouse", "redis"],
  langy: ["eventing", "prisma", "rateLimiter", "redis"],
  log: [],
  metric: [],
  "model-provider": ["redis"],
  monitor: ["monitor"],
  notification: [],
  onboarding: [],
  ops: ["adminEmails", "clickhouse", "eventing", "logger", "nodeEnvironment", "prisma", "redis"],
  organization: ["encryption", "logger", "prisma", "redis"],
  "platform-health": ["publicBaseUrl", "secrets"],
  presence: ["logger", "redis"],
  project: ["encryption", "logger", "topicClustering"],
  prompt: ["logger", "publicBaseUrl", "rateLimiter"],
  role: ["prisma"],
  scenario: ["clickhouse", "encryption", "publicBaseUrl", "rateLimiter"],
  secret: ["encryption"],
  share: ["redis"],
  "stored-object": ["clickhouse", "logger", "nodeEnvironment", "prisma", "secrets"],
  suite: ["clickhouse", "publicBaseUrl"],
  topic: ["prisma"],
  trace: ["clickhouse", "eventing", "logger", "processName", "producesPipelines", "publicBaseUrl", "rateLimiter", "redis"],
  user: ["prisma", "redis"],
  workflow: ["encryption", "prisma"],
  billing: [],
  governance: ["prisma"],
  licensing: ["logger", "prisma"],
  "managed-provider": [],
  scim: ["prisma"],
  sso: ["isSaas", "logger", "publicBaseUrl"],
  webhook: ["prisma", "rateLimiter"],
} as const;
