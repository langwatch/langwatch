/**
 * The two handoff screens' answer to their port, over `@langwatch/browser-host`
 * capabilities and this family's own `organization.getAll` query.
 * ARCHITECTURE.md §10.1.
 */

import { useUiCapabilities, useUiScope } from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";
import { useLocation } from "react-router";

import {
  AuthorizeHostApi,
  AuthorizeHostProvider,
  type AuthorizeFailureNotice,
  type AuthorizeRouteReading,
  type AuthorizeScope,
  type AuthorizeSessionStatus,
  type AuthorizeSuccessNotice,
  type McpAuthorizeAnswer,
  type McpAuthorizeRequest,
} from "../model/authorize-host.ts";
import { useApiKeyOrganizationGraph } from "./api-key-organization-graph.ts";
import { writeToClipboard } from "./browser-clipboard.ts";
import { authorizeMcpClient } from "./mcp-authorize-client.ts";

/** Same order-sensitive derivation as the API Key family's mount. */
function sessionStatusOf(hasActor: boolean, isSettled: boolean): AuthorizeSessionStatus {
  if (hasActor) return "authenticated";
  return isSettled ? "unauthenticated" : "loading";
}

class CapabilityAuthorizeHost extends AuthorizeHostApi {
  constructor(
    private readonly deps: {
      scope: AuthorizeScope;
      hasActor: boolean;
      isSettled: boolean;
      pathname: string;
      query: Readonly<Record<string, string | undefined>>;
      navigate: (to: string) => void;
      replace: (to: string) => void;
      projectApiKey: string | undefined;
      succeeded: (notice: AuthorizeSuccessNotice) => void;
      failed: (failure: AuthorizeFailureNotice) => void;
    },
  ) {
    super();
  }

  scope(): AuthorizeScope {
    return this.deps.scope;
  }

  sessionStatus(): AuthorizeSessionStatus {
    return sessionStatusOf(this.deps.hasActor, this.deps.isSettled);
  }

  route(): AuthorizeRouteReading {
    return { pathname: this.deps.pathname, query: this.deps.query };
  }

  navigate(to: string): void {
    this.deps.navigate(to);
  }

  replace(to: string): void {
    this.deps.replace(to);
  }

  /** Full navigation, deliberately: the MCP flow ends at the client's own callback. */
  handOffTo(url: string): void {
    if (typeof window !== "undefined") window.location.assign(url);
  }

  revealProjectApiKey(): string | undefined {
    return this.deps.projectApiKey;
  }

  /** No switcher is mounted below the root layout; the port says null is an answer. */
  projectSwitcher(): ReactNode {
    return null;
  }

  authorizeMcpClient(request: McpAuthorizeRequest): Promise<McpAuthorizeAnswer> {
    return authorizeMcpClient(request);
  }

  succeeded(notice: AuthorizeSuccessNotice): void {
    this.deps.succeeded(notice);
  }

  failed(failure: AuthorizeFailureNotice): void {
    this.deps.failed(failure);
  }

  async copyToClipboard(input: {
    text: string;
    succeeded: AuthorizeSuccessNotice;
  }): Promise<boolean> {
    const ok = await writeToClipboard(input.text);
    if (ok) this.deps.succeeded(input.succeeded);
    return ok;
  }
}

export default function AuthorizeHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback, navigation } = useUiCapabilities();
  const activeScope = useUiScope().activeScope();
  const location = useLocation();
  const graph = useApiKeyOrganizationGraph({
    organizationId: activeScope.organizationId ?? void 0,
    projectId: activeScope.projectId ?? void 0,
  });
  const sessionActor = session.currentUser();

  const host = useMemo(
    () =>
      new CapabilityAuthorizeHost({
        scope: {
          projectId: activeScope.projectId ?? void 0,
          projectName: graph.activeProject?.project.name,
        },
        hasActor: sessionActor !== null,
        isSettled: session.isSettled(),
        pathname: location.pathname,
        query: Object.fromEntries(new URLSearchParams(location.search).entries()),
        navigate: (to) => navigation.navigate(to),
        replace: (to) => navigation.replace(to),
        projectApiKey: graph.activeProject?.project.apiKey ?? void 0,
        succeeded: (notice) => feedback.succeeded(notice),
        failed: (failure) => feedback.failed(failure),
      }),
    [activeScope.projectId, graph, sessionActor, session, location, navigation, feedback],
  );

  return <AuthorizeHostProvider value={host}>{children}</AuthorizeHostProvider>;
}
