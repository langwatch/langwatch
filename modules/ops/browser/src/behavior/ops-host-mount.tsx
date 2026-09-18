/**
 * Ops' answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiDeployment,
  type UiFeedback,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";
import { useLocation } from "react-router";

import {
  OpsHostApi,
  OpsHostProvider,
  type OpsFailureNotice,
  type OpsProject,
  type OpsRouteReading,
  type OpsSuccessNotice,
} from "../model/ops-host.ts";

/** The two grants the Ops workspace and its strictly narrower Backoffice sit behind. */
const OPS_VIEW_PERMISSION = "ops:view";
const OPS_MANAGE_PERMISSION = "ops:manage";

class CapabilityOpsHost extends OpsHostApi {
  constructor(
    private readonly deps: {
      hasPermission: (permission: string) => boolean;
      sharedInstall: boolean;
      route: OpsRouteReading;
      asPath: string;
      setQuery: (
        next: Readonly<Record<string, string | undefined>>,
        options?: { replace?: boolean },
      ) => void;
      navigate: (to: string) => void;
      feedback: UiFeedback;
    },
  ) {
    super();
  }

  hasOpsAccess(): boolean {
    return this.deps.hasPermission(OPS_VIEW_PERMISSION);
  }

  isOpsAdmin(): boolean {
    return this.deps.hasPermission(OPS_MANAGE_PERMISSION);
  }

  sharedInstall(): boolean {
    return this.deps.sharedInstall;
  }

  /** No capability carries a project's own API key, so the Foundry gate stays closed. */
  project(): OpsProject | undefined {
    return void 0;
  }

  route(): OpsRouteReading {
    return this.deps.route;
  }

  asPath(): string {
    return this.deps.asPath;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.setQuery(next, options);
  }

  navigate(to: string): void {
    this.deps.navigate(to);
  }

  succeeded(notice: OpsSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: OpsFailureNotice): void {
    this.deps.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function OpsHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const { isSaaS } = useUiDeployment();
  const location = useLocation();
  const reading = route.reading();
  const asPath = `${location.pathname}${location.search}${location.hash}`;

  const host = useMemo(
    () =>
      new CapabilityOpsHost({
        hasPermission: (permission) => session.hasPermission(permission),
        sharedInstall: isSaaS,
        route: { params: reading.params, query: reading.query },
        asPath,
        setQuery: (next, options) => route.setQuery(next, options),
        navigate: (to) => navigation.navigate(to),
        feedback,
      }),
    [session, isSaaS, reading, asPath, route, navigation, feedback],
  );

  return <OpsHostProvider value={host}>{children}</OpsHostProvider>;
}
