/** Server-side wording for streaming capabilities, separate from browser CARD REGISTRY.
 * Relay is server transport and must not import UI composition. CLI_COLLECTION_VERBS keeps
 * server and browser in sync; the settled card handles richer presentation. */
import { CLI_COLLECTION_VERBS } from "@langwatch/langy-contract";

const NOUNS: Record<string, { singular: string; plural: string }> = {
  trace: { singular: "trace", plural: "traces" },
  session: { singular: "session", plural: "sessions" },
  analytics: { singular: "analytics query", plural: "analytics" },
  annotation: { singular: "annotation", plural: "annotations" },
  experiment: { singular: "experiment", plural: "experiments" },
  monitor: { singular: "monitor", plural: "monitors" },
  scenario: { singular: "scenario", plural: "scenarios" },
  scenariorun: { singular: "simulation run", plural: "simulation runs" },
  suite: { singular: "suite", plural: "suites" },
  prompt: { singular: "prompt", plural: "prompts" },
  agent: { singular: "agent", plural: "agents" },
  workflow: { singular: "workflow", plural: "workflows" },
  evaluator: { singular: "evaluator", plural: "evaluators" },
  dataset: { singular: "dataset", plural: "datasets" },
  dashboard: { singular: "dashboard", plural: "dashboards" },
  graph: { singular: "graph", plural: "graphs" },
  trigger: { singular: "trigger", plural: "triggers" },
  project: { singular: "project", plural: "projects" },
  "api-key": { singular: "API key", plural: "API keys" },
  "model-provider": { singular: "model provider", plural: "model providers" },
  secret: { singular: "secret", plural: "secrets" },
  "virtual-key": { singular: "virtual key", plural: "virtual keys" },
  budget: { singular: "gateway budget", plural: "gateway budgets" },
  webhook: { singular: "webhook endpoint", plural: "webhook endpoints" },
  organization: { singular: "organization", plural: "organizations" },
  member: { singular: "member", plural: "members" },
  invite: { singular: "invite", plural: "invites" },
  team: { singular: "team", plural: "teams" },
  "access-group": { singular: "access group", plural: "access groups" },
  role: { singular: "custom role", plural: "custom roles" },
  "role-binding": { singular: "role binding", plural: "role bindings" },
  "scim-token": { singular: "SCIM token", plural: "SCIM tokens" },
};

const PRESENT_VERBS: Record<string, string> = {
  search: "Searching",
  query: "Searching",
  list: "Listing",
  versions: "Listing",
  "list-runs": "Listing",
  records: "Listing",
  get: "Loading",
  show: "Loading",
  view: "Loading",
  status: "Checking",
  health: "Checking",
  results: "Loading",
  tail: "Loading",
  export: "Exporting",
  download: "Downloading",
  create: "Creating",
  init: "Creating",
  add: "Adding to",
  upload: "Uploading to",
  update: "Updating",
  set: "Updating",
  unset: "Updating",
  rotate: "Rotating",
  rename: "Updating",
  assign: "Assigning",
  restore: "Restoring",
  sync: "Syncing",
};

const humanize = (value: string): string =>
  value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export function deriveLangyCapabilityProgress(rawName: string): { headline: string } | null {
  const match = /^langwatch\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(rawName);
  if (!match) return null;
  const resource = match[1]!;
  const verb = match[2]!;
  const noun = NOUNS[resource] ?? {
    singular: humanize(resource).toLowerCase(),
    plural: `${humanize(resource).toLowerCase()}s`,
  };
  const label = CLI_COLLECTION_VERBS.has(verb) ? noun.plural : noun.singular;
  return { headline: `${PRESENT_VERBS[verb] ?? "Working on"} ${label}` };
}
