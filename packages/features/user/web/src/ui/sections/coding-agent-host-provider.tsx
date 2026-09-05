/**
 * What the coding-agent activity tables mount inside: the adapter between
 * `@langwatch/coding-agent-web`'s narrow port and the personal-workspace
 * host. Lives here, not `apps/ui`, since that package is ungoverned.
 */

import {
  CodingAgentActivityHostPort,
  CodingAgentActivityHostProvider,
  type CodingAgentFailure,
  type CodingAgentNotice,
  type CodingAgentRouteReading,
} from "@langwatch/coding-agent-web/surfaces/activity";
import { useMemo, type ComponentType, type ReactNode } from "react";

import {
  usePersonalWorkspaceHost,
  type PersonalWorkspaceHostPort,
} from "../../model/personal-workspace-host";

class PersonalCodingAgentHost extends CodingAgentActivityHostPort {
  constructor(private readonly host: PersonalWorkspaceHostPort) {
    super();
  }

  hasPermission(permission: string): boolean {
    return this.host.hasPermission(permission);
  }

  route(): CodingAgentRouteReading {
    return this.host.route();
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.host.setQuery(next, options);
  }

  navigate(to: string): void {
    this.host.navigate(to);
  }

  succeeded(notice: CodingAgentNotice): void {
    this.host.succeeded(notice);
  }

  failed(failure: CodingAgentFailure): void {
    this.host.failed(failure);
  }
}

export function CodingAgentHostBridge({ children }: { children: ReactNode }) {
  const host = usePersonalWorkspaceHost();
  const bridged = useMemo(() => new PersonalCodingAgentHost(host), [host]);
  return (
    <CodingAgentActivityHostProvider value={bridged}>{children}</CodingAgentActivityHostProvider>
  );
}

/** Wraps a screen that renders a coding-agent activity table. */
export function withCodingAgentHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <CodingAgentHostBridge>
      <Screen {...props} />
    </CodingAgentHostBridge>
  );
  Mounted.displayName = `withCodingAgentHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
