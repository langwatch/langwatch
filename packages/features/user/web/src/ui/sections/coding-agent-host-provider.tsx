/**
 * What the coding-agent activity tables are mounted inside.
 *
 * `@langwatch/coding-agent-web` owns the sessions and pull-request tables and
 * states what it needs as its own narrow port — one permission question, the
 * address, and the two notices. Everything on that port is already on the
 * personal-workspace host, so this is the adapter between them, mounted once
 * around any screen that renders a table.
 *
 * It lives here rather than in `apps/ui` for a boundary reason worth keeping:
 * `@langwatch/coding-agent-web` is not a governed web package, so a frontend
 * feature may not import it. The screen family that renders its tables can, so
 * the screen family answers its port.
 */

import {
  CodingAgentActivityHostPort,
  CodingAgentActivityHostProvider,
  type CodingAgentFailure,
  type CodingAgentNotice,
  type CodingAgentRouteReading,
} from "@langwatch/coding-agent-web/activity";
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
