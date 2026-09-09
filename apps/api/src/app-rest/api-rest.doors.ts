/**
 * Every REST door this process can open, in ONE list and in mount order. An
 * entry with a `mount` is a declared family; one without is unconverted. The
 * boot report, the family union and the description surface read this list.
 */
import { createErrorHandler } from "@langwatch/api";
import type { MountableRestApp } from "@langwatch/api/rest";
import { createDatasetErrorHandler, createDatasetRest } from "@langwatch/dataset-server";
import { billingStripeWebhookRest } from "@langwatch/enterprise-billing-server";
import { createEvaluatorRest } from "@langwatch/evaluator-server";
import { createMonitorsRest } from "@langwatch/monitor-server";
import type { Logger } from "@langwatch/observability";
import { secretRest, secretsAliasRest } from "@langwatch/secret-server";

import { mountAnnotationRest } from "../features/annotation/annotation-rest.mount.ts";
import { mountAuthCliDeviceFlowRest } from "../features/auth/auth-cli-device-flow-rest.mount.ts";
import { mountAuthRest } from "../features/auth/auth-rest.mount.ts";
import { mountApiKeyRest } from "../features/api-key/api-key-rest.mount.ts";
import {
  mountCodingAgentRest,
  mountCodingAgentRollupRest,
  mountCodingAgentV1Rest,
} from "../features/coding-agent/coding-agent-rest.mount.ts";
import { mountDashboardRest } from "../features/dashboard/dashboard-rest.mount.ts";
import { mountGithubInstallRest } from "../features/github/github-rest.mount.ts";
import { apiDiscoveryRest } from "../features/discovery/api-discovery.rest.ts";
import { gatewayOpenApiRest } from "../features/discovery/gateway-openapi.rest.ts";
import { rootDiscoveryRest } from "../features/discovery/root-discovery.rest.ts";
import { apiDocument, discoveryErrors } from "../features/discovery/openapi-serve.ts";
import { mountHealthProbeRest } from "../features/health/health-probe-rest.mount.ts";
import { mountImageProxyRest } from "../features/image-proxy/image-proxy-rest.mount.ts";
import { mountMcpAuthorizeRest } from "../features/mcp/mcp-authorize-rest.mount.ts";
import { mountPlatformHealthRest } from "../features/platform-health/platform-health-rest.mount.ts";
import { mountProjectRest } from "../features/project/project-rest.mount.ts";
import { mountRumRest } from "../features/rum/rum-rest.mount.ts";
import {
  mountScimProtocolRest,
  mountScimTokenRest,
  mountScimWebhookRest,
} from "../features/enterprise/scim-rest.mount.ts";
import { mountStoredObjectFileRest } from "../features/stored-object/stored-object-file-rest.mount.ts";
import { mountStoredObjectRest } from "../features/stored-object/stored-object-rest.mount.ts";
import { mountSuiteRest } from "../features/suite/suite-rest.mount.ts";
import { mountMeRest } from "../features/user/me-rest.mount.ts";
import { mountUserAvatarRest } from "../features/user/user-avatar-rest.mount.ts";
import type { ApiPackagedRestCollaborators } from "./api-rest.packaged-services.ts";
import type { ApiRestRuntime } from "./api-rest.runtime.ts";
import type { ApiRestPorts, ApiRestServices } from "./api-rest.services.ts";

/** Whether the family's transport is the process's own or a module's. */
export type ApiRestDoorOwner = "process" | "module";

/** Everything a door reaches to open itself. */
export type ApiRestDoorContext = Readonly<{
  /** The process's ONE runtime: every door on this list is opened through it. */
  runtime: ApiRestRuntime;
  services: ApiRestServices;
  ports: ApiRestPorts;
  /** The collaborators the module-owned families read, where composed. */
  packaged: ApiPackagedRestCollaborators | undefined;
}>;

/**
 * What a door's mount answers: the family, or nothing where this process
 * composed no service for it.
 */
export type ApiRestDoorMount = (
  context: ApiRestDoorContext,
) => readonly MountableRestApp[] | null;

/** One family, its addresses, and how this process opens it. */
export type ApiRestDoorEntry = Readonly<{
  family: string;
  owner: ApiRestDoorOwner;
  /** Every address the family answers at, as a caller writes it. */
  paths: readonly string[];
  /** Absent means the transport is unconverted and nothing can be built. */
  mount?: ApiRestDoorMount | undefined;
  /** What the deployment loses without it, where the standing sentence is wrong. */
  absent?: string | undefined;
}>;

/** The canonical envelope, for the families that answer refusals in it. */
const canonicalErrors = createErrorHandler();

/**
 * Every door, in mount order. ORDERING is load-bearing: the description
 * locations come first so no parameterised sibling can shadow them, and the
 * three families the process used to route last still answer last.
 */
export const API_REST_DOORS = [
  {
    family: "gateway-openapi",
    owner: "process",
    paths: ["/api/gateway/v1/openapi.json"],
    mount: ({ runtime }: ApiRestDoorContext) =>
      [runtime.mount(gatewayOpenApiRest.router(), () => apiDocument, { onError: discoveryErrors })],
  },
  {
    family: "api-discovery",
    owner: "process",
    paths: ["/api/openapi.json", "/api/v1/openapi.json"],
    mount: ({ runtime }: ApiRestDoorContext) =>
      [runtime.mount(apiDiscoveryRest.router(), () => apiDocument, { onError: discoveryErrors })],
  },
  {
    family: "root-discovery",
    owner: "process",
    paths: ["/.well-known/openapi", "/llms.txt"],
    mount: ({ runtime }: ApiRestDoorContext) =>
      [runtime.mount(rootDiscoveryRest.router(), () => apiDocument, { onError: discoveryErrors })],
  },
  {
    family: "rum",
    owner: "process",
    paths: ["/api/rum/v1/traces"],
    mount: ({ runtime, ports }: ApiRestDoorContext) =>
      [mountRumRest(runtime, { rateLimit: ports.rateLimit })],
  },
  {
    family: "health-probes",
    owner: "process",
    paths: [
      "/api/health/collector",
      "/api/health/evaluations",
      "/api/health/processor",
      "/api/health/triggers",
      "/api/health/workflows",
    ],
    mount: ({ runtime, ports }: ApiRestDoorContext) =>
      ports.healthProbes ? [mountHealthProbeRest(runtime, ports.healthProbes)] : null,
    absent:
      "API process serves no /api/health/* probes: this deployment declared no public origin, and every probe posts its canary back through one.",
  },
  {
    family: "platform-health",
    owner: "module",
    paths: ["/api/v1/platform-health", "/api/v1/platform-health/:check"],
    mount: ({ runtime, services }: ApiRestDoorContext) =>
      services.platformHealth ? [mountPlatformHealthRest(runtime, services.platformHealth)] : null,
  },
  { family: "analytics", owner: "process", paths: ["/api/analytics", "/api/v1/analytics"] },
  {
    family: "langwatch-ql",
    owner: "process",
    paths: ["/api/v1/projects/:projectId/analytics/*"],
  },
  { family: "query", owner: "process", paths: ["/api/v1/query"] },
  { family: "prompts", owner: "process", paths: ["/api/prompts", "/api/v1/prompts"] },
  {
    family: "organization-management",
    owner: "process",
    paths: ["/api/organization", "/api/v1/organization"],
  },
  { family: "trace-export", owner: "process", paths: ["/api/export/traces/download"] },
  { family: "scenario-run-export", owner: "process", paths: ["/api/export/scenario-runs"] },
  {
    family: "workflow-studio",
    owner: "process",
    paths: ["/api/workflows/code-completion", "/api/workflows/post_event"],
  },
  { family: "scenario-generate", owner: "process", paths: ["/api/scenario/generate"] },
  { family: "playground", owner: "process", paths: ["/api/playground"] },
  { family: "experiment-workbench", owner: "process", paths: ["/api/experiments"] },
  { family: "experiment-init", owner: "process", paths: ["/api/experiment/init"] },
  {
    family: "workflow-run",
    owner: "process",
    paths: ["/api/workflows/:id/run", "/api/optimization/:id/run"],
  },
  {
    family: "annotations",
    owner: "module",
    paths: ["/api/annotations", "/api/v1/annotations"],
    mount: ({ runtime, services }: ApiRestDoorContext) =>
      services.annotations ? [mountAnnotationRest(runtime, services.annotations)] : null,
  },
  {
    family: "stored-objects",
    owner: "module",
    paths: ["/api/stored-objects/2026-08-22"],
    mount: ({ runtime, services }: ApiRestDoorContext) =>
      services.storedObjects ? [mountStoredObjectRest(runtime, services.storedObjects)] : null,
  },
  { family: "admin", owner: "process", paths: ["/api/admin", "/api/v1/admin"] },
  { family: "bug-reports", owner: "process", paths: ["/api/bug-reports"] },
  { family: "unsubscribe", owner: "process", paths: ["/api/unsubscribe", "/api/v1/unsubscribe"] },
  { family: "cron", owner: "process", paths: ["/api/cron/*"] },
  {
    family: "github",
    owner: "module",
    paths: [
      "/api/github/install",
      "/api/github/setup",
      "/api/github/webhook",
      "/api/github-langy/setup",
      "/api/github-langy/webhook",
    ],
    mount: ({ runtime, ports }: ApiRestDoorContext) =>
      ports.github ? [mountGithubInstallRest(runtime, ports.github)] : null,
  },
  {
    family: "langy",
    owner: "process",
    paths: ["/api/langy/conversations", "/api/langy/ui", "/api/internal/langy/*"],
  },
  {
    family: "auth-cli-device-flow",
    owner: "module",
    // Ordered BEFORE `/api/auth`: that family is Better Auth's catch-all and
    // would otherwise swallow all seven of these paths.
    paths: ["/api/auth/cli/*", "/api/v1/auth/cli/*"],
    mount: ({ runtime, ports }: ApiRestDoorContext) => {
      const door = ports.authCliDeviceFlow;
      if (!door) return null;

      return [mountAuthCliDeviceFlowRest(runtime, { door: () => door, errors: ports.errors })];
    },
    absent:
      "API process serves no /api/auth/cli: the device grant needs a Redis to hold a device code, a database to re-derive membership from, and a browser session to name who approves. Without all three `langwatch login` cannot complete.",
  },
  { family: "governance-cli", owner: "process", paths: ["/api/v1/governance/*"] },
  {
    family: "auth",
    owner: "module",
    paths: ["/api/auth/*"],
    mount: ({ runtime, ports }: ApiRestDoorContext) => {
      const door = ports.auth;
      if (!door) return null;

      return [mountAuthRest(runtime, { door: () => door, errors: ports.errors })];
    },
    absent:
      "API process serves no /api/auth: it composed no Better Auth instance, no session transport, no credential service or no flag store, and a sign-in door missing any of them would answer every browser as signed out.",
  },
  { family: "governance-ingest", owner: "process", paths: ["/api/ingest/otel", "/api/ingest/webhook"] },
  {
    family: "scim",
    owner: "module",
    paths: ["/api/scim/v2/*"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) =>
      packaged?.services.scim ? [mountScimProtocolRest(runtime, packaged.services.scim)] : null,
  },
  {
    family: "scim-webhook",
    owner: "module",
    paths: ["/api/webhooks/auth0-scim"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) =>
      packaged?.services.scim ? [mountScimWebhookRest(runtime, packaged.services.scim)] : null,
  },
  { family: "traces", owner: "process", paths: ["/api/traces", "/api/v1/traces"] },
  { family: "trace-legacy", owner: "process", paths: ["/api/trace/*", "/api/thread/:id"] },
  {
    family: "evaluations-legacy",
    owner: "process",
    paths: ["/api/evaluations/*", "/api/v1/evaluations/*"],
  },
  { family: "agent-cache", owner: "module", paths: ["/api/agent-cache", "/api/v1/agent-cache"] },
  { family: "agents", owner: "module", paths: ["/api/agents"] },
  { family: "agents-v1", owner: "module", paths: ["/api/v1/agents"] },
  {
    family: "coding-agent",
    owner: "module",
    paths: ["/api/coding-agent/sessions/:sessionId/events"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) =>
      packaged?.services.codingAgents
        ? [mountCodingAgentRest(runtime, packaged.services.codingAgents)]
        : null,
  },
  {
    family: "coding-agent-rollup",
    owner: "module",
    paths: ["/api/coding-agent/pull-request-usage"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) =>
      packaged?.services.codingAgents
        ? [mountCodingAgentRollupRest(runtime, packaged.services.codingAgents)]
        : null,
  },
  {
    family: "coding-agent-v1",
    owner: "module",
    paths: ["/api/v1/coding-agent/pull-request-usage"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) =>
      packaged?.services.codingAgents
        ? [mountCodingAgentV1Rest(runtime, packaged.services.codingAgents)]
        : null,
  },
  {
    family: "dashboards",
    owner: "module",
    paths: ["/api/dashboards", "/api/graphs", "/api/v1/dashboards", "/api/v1/graphs"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) =>
      packaged?.services.dashboard ? mountDashboardRest(runtime, packaged.services.dashboard) : null,
  },
  {
    family: "evaluators",
    owner: "module",
    paths: ["/api/evaluators", "/api/v1/evaluators"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) => {
      if (!packaged?.services.evaluators) return null;

      return [
        runtime.mount(
          createEvaluatorRest(packaged.ports.platformUrl).router(),
          packaged.services.evaluators,
        ),
      ];
    },
  },
  { family: "experiments", owner: "module", paths: ["/api/v1/experiments"] },
  {
    family: "files",
    owner: "module",
    paths: ["/api/files/:projectId/:id", "/api/files/:id"],
    // BOTH doors, or neither: the dual-credential verifier the in-app player
    // fires through and the person's own project permission. Either absent
    // takes the family off rather than serving a read that could not authorize.
    mount: ({ runtime, packaged }: ApiRestDoorContext) => {
      if (!packaged?.services.storedObjects) return null;
      const requireProjectPermission = packaged.ports.requireProjectPermission;
      if (!requireProjectPermission || !packaged.ports.dualAuth) return null;

      return mountStoredObjectFileRest(runtime, {
        storedObjects: packaged.services.storedObjects,
        requireProjectPermission,
        rateLimit: packaged.ports.rateLimit,
      });
    },
  },
  { family: "governance", owner: "module", paths: ["/api/governance", "/api/v1/governance"] },
  { family: "groups", owner: "module", paths: ["/api/groups", "/api/v1/groups"] },
  {
    family: "me",
    owner: "module",
    paths: ["/api/me", "/api/v1/me"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) =>
      packaged?.services.users ? [mountMeRest(runtime, packaged.services.users)] : null,
  },
  {
    family: "model-providers",
    owner: "module",
    paths: ["/api/model-providers", "/api/v1/model-providers", "/api/v1/model-defaults"],
  },
  {
    family: "monitors",
    owner: "module",
    paths: ["/api/monitors", "/api/v1/monitors"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) => {
      if (!packaged?.services.monitors) return null;

      return [
        runtime.mount(
          createMonitorsRest(packaged.ports.platformUrl).router(),
          packaged.services.monitors,
        ),
      ];
    },
  },
  { family: "organizations", owner: "module", paths: ["/api/organizations", "/api/v1/organizations"] },
  {
    family: "projects",
    owner: "module",
    paths: ["/api/projects"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) => {
      const projects = packaged?.services.projects;
      const apiKeys = packaged?.services.apiKeys;
      if (!projects || !apiKeys) return null;

      return [mountProjectRest(runtime, { projects, apiKeys, errors: packaged.ports.legacyErrors })];
    },
  },
  { family: "scenario-events", owner: "module", paths: ["/api/scenario-events", "/api/v1/scenario-events"] },
  { family: "scenarios", owner: "module", paths: ["/api/scenarios", "/api/v1/scenarios"] },
  {
    family: "scim-tokens",
    owner: "module",
    paths: ["/api/scim-tokens", "/api/v1/scim-tokens"],
    // BOTH, or neither: a deployment that composed no Enterprise plan gate
    // leaves the family off rather than mounting it ungated — the same rule
    // groups, roles and role bindings answer to.
    mount: ({ runtime, packaged }: ApiRestDoorContext) =>
      packaged?.services.scim && packaged.ports.enterpriseGate
        ? [mountScimTokenRest(runtime, packaged.services.scim)]
        : null,
  },
  { family: "simulation-runs", owner: "module", paths: ["/api/simulation-runs", "/api/v1/simulation-runs"] },
  {
    family: "user-avatar",
    owner: "module",
    paths: ["/api/user-avatar/:projectId/:id"],
    // The byte door's verifier decides this family, and the runtime installs
    // it under every session door: absent, the mount would refuse by name.
    mount: ({ runtime, packaged }: ApiRestDoorContext) => {
      const users = packaged?.services.users;
      if (!users || !packaged?.ports.dualAuth) return null;

      return [mountUserAvatarRest(runtime, users)];
    },
    absent:
      "API process serves no /api/user-avatar: it composed no stored-object read, or no dual-credential verifier for the browser to load an image with. Every member list, annotation and presence bar falls back to initials rather than the photo a person uploaded.",
  },
  { family: "teams", owner: "module", paths: ["/api/teams", "/api/v1/teams"] },
  {
    family: "tracked-events",
    owner: "module",
    paths: ["/api/events/track", "/api/track_event"],
    absent:
      "API process serves neither /api/events/track nor /api/track_event: recording a feedback event needs the trace command queue this process did not register, and a door mounted without one would answer 200 to a rating it then dropped.",
  },
  { family: "triggers", owner: "module", paths: ["/api/triggers", "/api/trigger/slack"] },
  { family: "webhooks", owner: "module", paths: ["/api/webhooks/v1/*"] },
  { family: "workflows", owner: "module", paths: ["/api/workflows", "/api/v1/workflows"] },
  { family: "ops-clickhouse-explain", owner: "process", paths: ["/api/ops/clickhouse/explain"] },
  { family: "dspy-steps", owner: "process", paths: ["/api/dspy/log_steps", "/api/v1/dspy/log_steps"] },
  {
    family: "mcp-authorize",
    owner: "module",
    paths: ["/api/mcp/authorize"],
    mount: ({ runtime, ports }: ApiRestDoorContext) =>
      ports.mcpAuthorize ? [mountMcpAuthorizeRest(runtime, ports.mcpAuthorize)] : null,
  },
  {
    family: "image-proxy",
    owner: "process",
    paths: ["/api/image-proxy", "/api/v1/image-proxy"],
    mount: ({ runtime, ports }: ApiRestDoorContext) =>
      ports.imageProxy ? [mountImageProxyRest(runtime, ports.imageProxy)] : null,
  },
  { family: "collector", owner: "process", paths: ["/api/collector"] },
  {
    family: "otlp-ingest",
    owner: "process",
    paths: ["/api/otel/v1/traces", "/api/otel/v1/logs", "/api/otel/v1/metrics"],
  },
  {
    family: "dataset",
    owner: "module",
    paths: ["/api/dataset", "/api/v1/dataset"],
    mount: ({ runtime, ports, packaged }: ApiRestDoorContext) => {
      if (!packaged?.services.datasets) return null;

      return [
        runtime.mount(createDatasetRest(ports.platformUrl).router(), packaged.services.datasets, {
          onError: createDatasetErrorHandler({ boundaryErrorHandler: ports.errors }),
        }),
      ];
    },
  },
  {
    family: "secrets",
    owner: "module",
    paths: ["/api/secret", "/api/secrets", "/api/v1/secret", "/api/v1/secrets"],
    mount: ({ runtime, services }: ApiRestDoorContext) => {
      const secrets = services.secrets;
      if (!secrets) return null;

      return [
        runtime.mount(secretRest.router(), secrets, { onError: canonicalErrors }),
        runtime.mount(secretsAliasRest.router(), secrets, { onError: canonicalErrors }),
      ];
    },
  },
  {
    family: "suites",
    owner: "module",
    paths: ["/api/v1/run-plans", "/api/v1/test-suites", "/api/suites"],
    mount: ({ runtime, services, ports }: ApiRestDoorContext) =>
      services.suites
        ? mountSuiteRest(runtime, {
            suites: services.suites,
            platformUrl: ports.platformUrl,
            errors: ports.errors,
          })
        : null,
  },
  { family: "gateway-platform", owner: "module", paths: ["/api/gateway/v1/*"] },
  {
    family: "gateway-spend",
    owner: "module",
    paths: ["/api/gateway/v1/spend-events", "/api/gateway/v1/spend-summaries"],
  },
  { family: "gateway-internal", owner: "module", paths: ["/api/internal/gateway/*"] },
  { family: "elevenlabs-webhook", owner: "module", paths: ["/api/elevenlabs/webhook"] },
  {
    family: "api-keys",
    owner: "module",
    paths: ["/api/api-keys", "/api/v1/api-keys"],
    mount: ({ runtime, packaged }: ApiRestDoorContext) => {
      const apiKeys = packaged?.services.apiKeys;
      if (!apiKeys) return null;

      return [mountApiKeyRest(runtime, { apiKeys, audit: packaged.ports.managementAudit })];
    },
  },
  {
    family: "billing-webhook",
    owner: "module",
    paths: ["/api/webhooks/stripe", "/api/v1/webhooks/stripe"],
    mount: ({ runtime, services }: ApiRestDoorContext) =>
      services.billingWebhook
        ? [runtime.mount(billingStripeWebhookRest.router(), services.billingWebhook)]
        : null,
  },
  { family: "sse-subscriptions", owner: "process", paths: ["/api/sse/*"] },
] as const satisfies readonly ApiRestDoorEntry[];

/** Every family this process names, mounted or not. Derived, never restated. */
export type ApiRestFamilyName = (typeof API_REST_DOORS)[number]["family"];

/** Told once, at boot, about each family this process does not serve. */
export abstract class ApiRestAbsenceReport {
  abstract absent(family: string, reason: string): void;
}

/**
 * Opens every door on the list, in order, and names the ones it could not.
 */
export function openApiRestDoors(options: {
  context: ApiRestDoorContext;
  report?: ApiRestAbsenceReport | undefined;
}): MountableRestApp[] {
  const opened: MountableRestApp[] = [];
  const doors: readonly ApiRestDoorEntry[] = API_REST_DOORS;

  for (const entry of doors) {
    if (!entry.mount) {
      options.report?.absent(entry.family, entry.absent ?? unconverted(entry.family));
      continue;
    }

    const built = entry.mount(options.context);

    if (!built) {
      options.report?.absent(entry.family, entry.absent ?? uncomposed(entry.family));
      continue;
    }

    opened.push(...built);
  }

  return opened;
}

/** A family whose transport cannot be built at all. */
function unconverted(family: string): string {
  return (
    `API process serves no ${family} REST family: its transport is still written against ` +
    "the deleted REST builders, so the family is not mounted at all."
  );
}

/** A family this process could have built and composed no service for. */
function uncomposed(family: string): string {
  return `API process composed no service for the ${family} REST family: it is not mounted.`;
}

/** Writes each family this process does not serve to the process log, once. */
export class LoggedApiRestAbsence extends ApiRestAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiRestAbsence {
    return new LoggedApiRestAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(family: string, reason: string): void {
    this.logger.warn({ family }, reason);
  }
}
