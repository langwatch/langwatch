import type { DashboardService } from "@langwatch/dashboard-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { Hono } from "hono";

import { createGovernanceRestApp } from "../features/governance/governance-rest";
import { createGraphsRestApp } from "../features/graphs/graphs-rest";
import { createModelDefaultsRestApp } from "../features/model-defaults/model-defaults-rest";
import type { AppRestSecurity } from "./app-rest.security";

/**
 * The capabilities the REST families this package owns dispatch through.
 *
 * Each is a provider rather than an instance: mounting a family must not force
 * its service to be constructed, which is what lets the OpenAPI generator and
 * the route-registry audits build every family without a running process.
 */
export interface AppRestFeatureServices {
  dashboard: () => DashboardService;
  governance: () => GovernanceService;
  modelProviders: () => ModelProviderService;
  projects: () => ProjectService;
}

/**
 * Every REST family this package owns, built against one process's security.
 *
 * The one list. A route family reaches the route-policy registry when it is
 * built, and the registry is what the route-authorization audit and the Langy
 * permission suites read — so a second enumeration anywhere would let a family
 * drop silently out of an audit while still serving traffic. Mount them by
 * iterating this, and read them the same way.
 */
export function createAppRestFeatures(options: {
  security: AppRestSecurity;
  services: AppRestFeatureServices;
}): MountableRestApp[] {
  const { security, services } = options;
  return [
    createGovernanceRestApp({
      security,
      governance: services.governance,
      projects: services.projects,
    }).hono,
    createGraphsRestApp({ security, dashboard: services.dashboard }).hono,
    createModelDefaultsRestApp({
      security,
      modelProviders: services.modelProviders,
    }).hono,
  ];
}

/**
 * A family's Hono app as a mount target.
 *
 * Each family carries its own request-context shape, and Hono's environment
 * parameter is invariant, so no single concrete `Hono<E>` accepts them all.
 * This is the same erasure Hono's own `route()` signature performs on the
 * sub-app it mounts: the parent reads nothing out of the child's environment,
 * so nothing is lost and the caller needs no cast of its own.
 */
export type MountableRestApp = Hono<any, any, any>;

/**
 * Service providers for a caller that only needs the families BUILT, never
 * served: the OpenAPI generator walks route metadata, and the route-registry
 * audits read the policies registered as a route is declared. Neither invokes
 * a handler, so reaching one of these is a bug in that caller rather than a
 * missing wire.
 */
export function servicesUnavailableOffRequestPath(reason: string): AppRestFeatureServices {
  const refuse =
    <T>(service: string) =>
    (): T => {
      throw new Error(`${service} is not available ${reason}`);
    };
  return {
    dashboard: refuse("Dashboard"),
    governance: refuse("Governance"),
    modelProviders: refuse("Model providers"),
    projects: refuse("Projects"),
  };
}
