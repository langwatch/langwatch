/**
 * Every tRPC namespace this process serves, one entry each, on one mount. A
 * namespace is here exactly when its module's transport is converted; every
 * other one is on the absence list beside this file and named at boot.
 */
import { bindTrpcFact } from "@langwatch/api/trpc";
import {
  billingCallerEmailFact,
  currencyRequestHeadersFact,
  currencyTrpcTransport,
  subscriptionTrpcTransport,
  type BillingSubscriptionApi,
} from "@langwatch/enterprise-billing-server";
import { scimTokenTrpcTransport, webhookEndpointTrpcTransport } from "@langwatch/enterprise-api";
import { HandledError } from "@langwatch/handled-error";

import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../api.application.ts";
import type { ApiTrpcInfrastructure } from "../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ComposedApiFeatures } from "./app-trpc.composed.ts";
import { createAuthzTrpcRouter } from "../features/authz/authz-trpc.mount.ts";
import { createSsoConnectionTrpcRouter } from "../features/sso/sso-trpc.mount.ts";
import { composeGithubTrpcRouter } from "../features/github/github.composition.ts";
import {
  createLicenseEnforcementTrpcRouter,
  createLicenseTrpcRouter,
} from "../features/enterprise/licensing-trpc.mount.ts";

/**
 * Builds every namespace this process owns against one mount. Nothing here is
 * conditional: each composed feature has a refusing twin, so a deployment that
 * composed no application for one still answers its namespace by name.
 */
export function createAppTrpcFeatures(options: {
  mount: ApiTrpcFeatureMount;
  /** What a feature composes ITSELF from, for the features composed here. */
  infrastructure: ApiTrpcInfrastructure;
  /**
   * The features composed BEFORE the mount existed, because their doors are
   * not only tRPC: the annotation application is read by `ctx.app` and by a
   * REST family, so the process composes it once and hands the router half here.
   */
  composed: ComposedApiFeatures;
}) {
  const { mount, composed, infrastructure } = options;
  const annotationRouters = composed.annotation.routers(mount);
  const authRouters = composed.auth.routers(mount);
  const dashboardRouters = composed.dashboard.routers(mount);
  const datasetRouters = composed.dataset.routers(mount);
  const entitlementRouters = composed.entitlement.routers(mount);
  const evaluationRouters = composed.evaluation.routers(mount);
  const monitorRouters = composed.monitor.routers(mount);
  const roleRouters = composed.role.routers(mount);
  const secretRouters = composed.secret.routers(mount);
  const shareRouters = composed.share.routers(mount);
  const userRouters = composed.user.routers(mount);

  return {
    // A reviewer's comments and their scores, over the same application the
    // `/api/annotations` family answers from.
    annotation: annotationRouters.annotation,
    annotationScore: annotationRouters.annotationScore,
    // A tenant's credentials, over the application the two REST families read.
    apiKey: composed.apiKey.router(mount),
    // What the caller may do at one scope, as the product reports their own
    // standing back to them. It takes no ports: the answer comes from the same
    // AuthZ service every declared check on this root already runs on.
    authz: createAuthzTrpcRouter(mount.runtime),
    batchRecord: datasetRouters.batchRecord,
    codingAgents: composed.codingAgent.router(mount),
    costs: entitlementRouters.costs,
    // The two Enterprise billing surfaces. Both mount on every deployment: the
    // quoted currency is public reference data, and a deployment that composed
    // no payment provider refuses `subscription.*` by name rather than
    // dropping the namespace out from under its client.
    currency: mount.runtime.mount(currencyTrpcTransport, (ctx) => ctx.app.billingCurrency, {
      facts: [bindTrpcFact(currencyRequestHeadersFact, (ctx) => ctx.req?.headers ?? null)],
    }),
    dashboards: dashboardRouters.dashboards,
    // A project's datasets and the rows inside them: three wire names for one
    // application, because the rows are only reachable through the dataset
    // that holds them.
    dataset: datasetRouters.dataset,
    datasetRecord: datasetRouters.datasetRecord,
    // The scoped privacy rules: the cascade is resolved through the project
    // and organization directories, and both writes anchor the target scope
    // before they authorize it.
    dataPrivacy: composed.dataPrivacy.router(mount),
    dataRetention: composed.dataRetention.router(mount),
    // One trace re-scored, on the same `evaluation_processing` producer the
    // workbench's own runs report on.
    evaluations: evaluationRouters.evaluations,
    // The evaluators a project defines, beside the `evaluations.*` surface
    // that RUNS them: a definition and a result are two things.
    evaluators: composed.evaluator.router(mount),
    // Which rollouts this tenant is inside. No declared-permission policy and
    // no ports, and both are the same decision: every procedure authorizes the
    // exact tenant target it was asked for inside the module's own resolver.
    featureFlag: composed.featureFlag.router(mount),
    frontDoor: authRouters.frontDoor,
    // The GitHub App an organization connected, and the pull requests its
    // coding agents opened.
    github: composeGithubTrpcRouter({ mount, infrastructure }),
    graphs: dashboardRouters.graphs,
    home: composed.home.router(mount),
    httpProxy: composed.httpProxy.router(mount),
    identity: userRouters.identity,
    // The setup checklist: nine other verticals' evidence plus the project's
    // own two columns, and no one module holds it.
    integrationsChecks: composed.integrationsChecks.router(mount),
    // What this instance is licensed for, and the ceilings that licence sets.
    // The procedures are declared in the module's own contract, and
    // `ctx.app.licensing` is the one application that answers both.
    license: createLicenseTrpcRouter(mount.runtime),
    licenseEnforcement: createLicenseEnforcementTrpcRouter(mount.runtime),
    limits: entitlementRouters.limits,
    monitors: monitorRouters.monitors,
    pinnedTrace: shareRouters.pinnedTrace,
    // What this organization is on. No ports either: the plan is resolved off
    // the one entitlement application, because ONE answer to "which plan" is
    // the whole point of a plan provider.
    plan: entitlementRouters.plan,
    // Who else is looking at this project, and where their cursor is. In this
    // record rather than beside it because two of its four procedures are
    // subscriptions: a namespace mounted outside the record would be callable
    // over `/api/trpc` and un-watchable over `/api/sse`.
    presence: composed.presence.router(mount),
    project: composed.project.router(mount),
    // A procedure rather than a router: the client calls `publicEnv({})` at
    // the root, and giving it a namespace would rename it.
    publicEnv: authRouters.publicEnv,
    // Custom role definitions, and the bindings that hand them out: who holds
    // a role and what that role grants are one question asked from two ends.
    role: roleRouters.role,
    roleBinding: roleRouters.roleBinding,
    savedViews: dashboardRouters.savedViews,
    // The directory-sync credentials the settings page mints, over the SAME
    // application the `/api/scim-tokens` family answers from.
    scimToken: mount.runtime.mount(scimTokenTrpcTransport, (ctx) => ctx.app.scim),
    // A project's stored credentials. In the record rather than beside it: the
    // namespace used to be mounted on the root directly, which put it outside
    // every audit that reads this list.
    secrets: secretRouters.secrets,
    share: shareRouters.share,
    // The back office's connection ledger. The procedures are declared in the
    // module's own contract, and `ctx.app.sso` is what answers them.
    ssoConnections: createSsoConnectionTrpcRouter(mount.runtime),
    storedObjects: composed.storedObject.router(mount),
    subscription: mount.runtime.mount(subscriptionTrpcTransport, requireSaasBilling, {
      facts: [bindTrpcFact(billingCallerEmailFact, (ctx) => ctx.session?.user.email ?? null)],
    }),
    topics: composed.topic.router(mount),
    // The signed-in person's own account.
    user: userRouters.user,
    // Where a spend event is delivered. The entitlement gate is inside the
    // handlers, so nothing decorates this mount.
    webhookEndpoints: mount.runtime.mount(webhookEndpointTrpcTransport, (ctx) => ctx.app.webhooks),
    // One wire namespace assembled from two modules, exactly as the client has
    // always called it. Only the DASHBOARD's half is converted, so the charted
    // reads and the workbench under the same name answer 404 until the
    // analytics module's transport lands; the saved charts answer now.
    analytics: mount.root.router({
      savedWorkbenchCharts: dashboardRouters.savedWorkbenchCharts,
    }),
  };
}

/**
 * The record {@link createAppTrpcFeatures} returns, at THIS process's mount.
 */
export type AppTrpcFeatureRecord = ReturnType<typeof createAppTrpcFeatures>;

/**
 * `subscription.*` on a deployment that composed no payment provider. The
 * namespace is mounted either way, so a client's inferred types never depend on
 * the deployment; every procedure then refuses by name instead of billing.
 */
class ApiBillingUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "This deployment does not bill through a payment provider.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiBillingUnavailableError";
  }
}

/** The billing application, or the refusal a deployment without one answers. */
function requireSaasBilling(ctx: ApiTrpcContext): BillingSubscriptionApi {
  const subscription = ctx.app.billingSubscription;
  if (subscription) return subscription;

  return new Proxy({} as BillingSubscriptionApi, {
    get:
      () =>
      (): never => {
        throw new ApiBillingUnavailableError();
      },
    has: () => true,
  });
}
