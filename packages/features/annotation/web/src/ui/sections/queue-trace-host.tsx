/**
 * The trace host, answered from the annotation host already above this
 * page, since `ConversationView` requires `trace-web`'s `TraceHostPort`.
 * Fields the walker never reaches answer `undefined` here.
 */

import {
  TraceHostPort,
  TraceHostProvider,
  type TraceFailureNotice,
  type TraceHostOrganization,
  type TraceHostOrganizationRole,
  type TraceHostProject,
  type TraceHostTeam,
  type TraceHostUser,
  type TraceRouteReading,
  type TraceSuccessNotice,
} from "@langwatch/trace-web/surfaces/trace-host";
import { useMemo, type ReactNode } from "react";

import { useAnnotationHost, type AnnotationHostPort } from "../../model/annotation-host";

class AnnotationTraceHost extends TraceHostPort {
  constructor(private readonly host: AnnotationHostPort) {
    super();
  }

  project(): TraceHostProject | undefined {
    const project = this.host.project();
    return project ? { id: project.id, slug: project.slug, name: project.name } : void 0;
  }

  organization(): TraceHostOrganization | undefined {
    return void 0;
  }

  team(): TraceHostTeam | undefined {
    return void 0;
  }

  organizationRole(): TraceHostOrganizationRole {
    return void 0;
  }

  currentUser(): TraceHostUser | undefined {
    const user = this.host.currentUser();
    return user ? { id: user.id, name: user.name, image: user.image } : void 0;
  }

  hasPermission(permission: string): boolean {
    return this.host.hasPermission(permission);
  }

  isLoading(): boolean {
    return !this.host.project();
  }

  route(): TraceRouteReading {
    const { params, query } = this.host.route();
    return { params, query, pathname: "" };
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

  succeeded(notice: TraceSuccessNotice): void {
    this.host.succeeded(notice);
  }

  failed(failure: TraceFailureNotice): void {
    this.host.failed(failure);
  }
}

/** Puts the trace host over whatever the walker renders. */
export function QueueTraceHost({ children }: { children: ReactNode }) {
  const host = useAnnotationHost();
  const traceHost = useMemo(() => new AnnotationTraceHost(host), [host]);
  return <TraceHostProvider value={traceHost}>{children}</TraceHostProvider>;
}
