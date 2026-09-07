import { describe, expect, expectTypeOf, it } from "vitest";
import {
  FEATURE_NAMES,
  type FeatureName,
  type PublicNamespace,
  publicNamespace,
  publicNamespaceFromUnknown,
} from "../src/feature-namespace.ts";

const EXPECTED_PUBLIC_NAMESPACES = {
  agent: "agents",
  analytics: "analytics",
  annotation: "annotations",
  "api-key": "api-keys",
  auth: "auth",
  authz: "authz",
  automation: "automations",
  "coding-agent": "coding-agents",
  dashboard: "dashboards",
  "data-privacy": "data-privacy",
  "data-retention": "data-retention",
  dataset: "datasets",
  entitlement: "entitlements",
  evaluation: "evaluations",
  evaluator: "evaluators",
  experiment: "experiments",
  "feature-flag": "feature-flags",
  gateway: "gateways",
  github: "github",
  "hosted-mcp": "hosted-mcps",
  identity: "identities",
  langy: "langy",
  log: "logs",
  metric: "metrics",
  "model-provider": "model-providers",
  monitor: "monitors",
  navigation: "navigations",
  notification: "notifications",
  onboarding: "onboardings",
  ops: "ops",
  organization: "organizations",
  presence: "presence",
  project: "projects",
  prompt: "prompts",
  role: "roles",
  scenario: "scenarios",
  secret: "secrets",
  share: "shares",
  "stored-object": "stored-objects",
  suite: "suites",
  topic: "topics",
  trace: "traces",
  user: "users",
  workflow: "workflows",
  "audit-log": "audit-logs",
  billing: "billing",
  governance: "governance",
  licensing: "licensing",
  "managed-provider": "managed-providers",
  saas: "saas",
  scim: "scim",
  sso: "sso",
  webhook: "webhooks",
} as const satisfies { [F in FeatureName]: PublicNamespace<F> };

describe("feature namespaces", () => {
  it("contains every catalogue owner", () => {
    expect(FEATURE_NAMES).toHaveLength(Object.keys(EXPECTED_PUBLIC_NAMESPACES).length);
    for (const feature of FEATURE_NAMES) {
      expect(publicNamespace(feature)).toBe(EXPECTED_PUBLIC_NAMESPACES[feature]);
    }
  });

  it("rejects unknown runtime names", () => {
    expect(() => publicNamespaceFromUnknown("unknown-feature")).toThrow("Unknown feature name");
  });

  it("keeps literal namespace types", () => {
    expectTypeOf(publicNamespace("annotation")).toEqualTypeOf<"annotations">();
    expectTypeOf<PublicNamespace<"api-key">>().toEqualTypeOf<"api-keys">();
    expectTypeOf<PublicNamespace<"identity">>().toEqualTypeOf<"identities">();
    expectTypeOf<FeatureName>().toEqualTypeOf<(typeof FEATURE_NAMES)[number]>();
  });
});
