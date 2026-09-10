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
  agent: [],
  analytics: [],
  annotation: [],
  "api-key": [],
  auth: [],
  authz: [],
  automation: [],
  "coding-agent": [],
  dashboard: [],
  "data-privacy": [],
  "data-retention": [],
  dataset: [],
  entitlement: [],
  evaluation: [],
  evaluator: [],
  experiment: [],
  "feature-flag": [],
  gateway: [],
  github: [],
  "hosted-mcp": [],
  identity: [],
  langy: [],
  log: [],
  metric: [],
  "model-provider": [],
  monitor: [],
  notification: [],
  ops: [],
  organization: [],
  "platform-health": [],
  presence: [],
  project: [],
  prompt: [],
  role: [],
  scenario: [],
  secret: [],
  share: [],
  "stored-object": [],
  suite: [],
  topic: [],
  trace: [],
  user: [],
  webhook: [],
  workflow: [],
} as const;
