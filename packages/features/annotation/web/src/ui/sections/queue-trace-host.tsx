/**
 * The trace host, answered from the annotation host.
 *
 * THE WALKER MOUNTS A TRACE SURFACE, and that surface asks its own family for a
 * host: `ConversationView` and `useConversationTurns` read
 * `@langwatch/trace-web`'s `TraceHostPort` for the project the turns belong to,
 * and throw without one. Rather than make the composing application mount two
 * hosts around one page — which would put a cross-feature import in `apps/ui`
 * and give the reader's grants two answers — the bridge lives here, where the
 * coupling actually is, and reads every answer off the annotation host that is
 * already above it.
 *
 * WHAT IS NOT ANSWERED, and why each absence is safe on this page: the
 * organization, the team and the organization ROLE are read by the explorer's
 * Langy gate, its presence dots and its personal-workspace checks — none of
 * which the conversation view renders. `firstMessage` and `apiKey` belong to
 * the explorer's empty state and its Integrate pane. The walker never reaches
 * any of them, so answering `undefined` is honest rather than lossy; the day it
 * does, the annotation host is where the answer gets added.
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
} from "@langwatch/trace-web/screens/traces";
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
