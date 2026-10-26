/**
 * The two handoff screens' answer to their port, over `@langwatch/browser-host`
 * host services and this family's own `organization.getAll` query.
 * ARCHITECTURE.md §10.1.
 */

import {
  ApiKeyScopeViolationError,
  publicDocsOrigins,
  type DocsSessionKeyMinted,
} from "@langwatch/api-key-contract";
import { useUiHostServices, useUiScope } from "@langwatch/browser-host/capabilities";
import { useLent } from "@langwatch/browser-host/lent";
import { readPublicAppConfig } from "@langwatch/browser/public-config";
import { ProjectSwitcherToken } from "@langwatch/project-client";
import type { ProjectSwitcherProps } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import { Suspense, useMemo, type ComponentType, type ReactNode } from "react";
import { useLocation } from "react-router";

import {
  AuthorizeHostApi,
  AuthorizeHostProvider,
  type DocsOpener,
  type AuthorizeFailureNotice,
  type AuthorizeRouteReading,
  type AuthorizeScope,
  type AuthorizeSessionStatus,
  type AuthorizeSuccessNotice,
  type McpAuthorizeAnswer,
  type McpAuthorizeRequest,
} from "../model/authorize-host.ts";
import { cappedDeviceFlowPermissions, projectTokenInput } from "../model/project-token-input.ts";
import { apiKeyApi } from "./api-key-api.ts";
import { writeToClipboard } from "./api-key-host-mount.tsx";
import { useApiKeyOrganizationGraph } from "./api-key-organization-graph.ts";
import { authorizeMcpClient } from "./mcp-authorize-client.ts";

/** Same order-sensitive derivation as the API Key family's mount. */
function sessionStatusOf(hasActor: boolean, isSettled: boolean): AuthorizeSessionStatus {
  if (hasActor) return "authenticated";
  return isSettled ? "unauthenticated" : "loading";
}

class HostServiceAuthorizeHost extends AuthorizeHostApi {
  constructor(
    private readonly deps: {
      scope: AuthorizeScope;
      hasActor: boolean;
      isSettled: boolean;
      pathname: string;
      query: Readonly<Record<string, string | undefined>>;
      navigate: (to: string) => void;
      replace: (to: string) => void;
      mintProjectToken: (input: { expiresAt: Instant | undefined }) => Promise<string | undefined>;
      Switcher: ComponentType<ProjectSwitcherProps> | undefined;
      impersonated: boolean;
      mintDocsSessionKey: (input: {
        projectId: string;
        docsOrigin: string;
      }) => Promise<DocsSessionKeyMinted>;
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

  mintProjectToken(input: { expiresAt: Instant | undefined }): Promise<string | undefined> {
    return this.deps.mintProjectToken(input);
  }

  /** The switcher project lends by token (ARCHITECTURE §10), drawn inside the card. */
  projectSwitcher(): ReactNode {
    const { Switcher } = this.deps;
    if (!Switcher) return null;
    return (
      <Suspense fallback={null}>
        <Switcher />
      </Suspense>
    );
  }

  authorizeMcpClient(request: McpAuthorizeRequest): Promise<McpAuthorizeAnswer> {
    return authorizeMcpClient(request);
  }

  docsOrigins(): readonly string[] {
    return docsOriginsOfPage();
  }

  actingAsAnother(): boolean {
    return this.deps.impersonated;
  }

  /** Posts only through `postMessage` with an exact target origin; the popup reads nothing back. */
  docsOpener(): DocsOpener | null {
    if (typeof window === "undefined" || !window.opener) return null;
    const opener = window.opener as Window;

    return { post: ({ message, targetOrigin }) => opener.postMessage(message, targetOrigin) };
  }

  mintDocsSessionKey(input: { projectId: string; docsOrigin: string }) {
    return this.deps.mintDocsSessionKey(input);
  }

  closeWindow(): void {
    if (typeof window !== "undefined") window.close();
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

/** The page config's docs origins; a shell without one registers none, so nothing connects. */
function docsOriginsOfPage(): readonly string[] {
  try {
    return publicDocsOrigins(readPublicAppConfig());
  } catch {
    return [];
  }
}

export default function AuthorizeHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback, navigation } = useUiHostServices();
  const activeScope = useUiScope().activeScope();
  const location = useLocation();
  const graph = useApiKeyOrganizationGraph({
    organizationId: activeScope.organizationId ?? void 0,
    projectId: activeScope.projectId ?? void 0,
  });
  const sessionActor = session.currentUser();
  // What the person holds on the project, resolved by the server: the token's ceiling.
  const standing = apiKeyApi.authz.effectivePermissions.useQuery(
    { projectId: activeScope.projectId ?? "" },
    { enabled: !!activeScope.projectId },
  );
  const { refetch: refetchStanding } = standing;
  // As `useMintPersonalToken`: the token is never kept in the mutation cache.
  const { mutateAsync: mintToken, reset: resetMint } = apiKeyApi.apiKey.create.useMutation({
    gcTime: 0,
  });
  // The docs key is answered once to the opener and never kept in the mutation cache.
  const { mutateAsync: mintDocsKey, reset: resetDocsMint } =
    apiKeyApi.apiKey.mintDocsSessionKey.useMutation({ gcTime: 0 });
  const Switcher = useLent(ProjectSwitcherToken);

  const host = useMemo(
    () =>
      new HostServiceAuthorizeHost({
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
        mintProjectToken: async ({ expiresAt }) => {
          const { organizationId, projectId } = activeScope;
          if (!organizationId || !projectId) return void 0;
          const held = (standing.data ?? (await refetchStanding()).data)?.permissions ?? [];
          const permissions = cappedDeviceFlowPermissions({ held });
          if (permissions.length === 0) {
            throw new ApiKeyScopeViolationError(
              "You hold none of the permissions a token needs on this project.",
            );
          }
          try {
            return (
              await mintToken(
                projectTokenInput({ organizationId, projectId, permissions, expiresAt }),
              )
            ).token;
          } finally {
            resetMint();
          }
        },
        Switcher,
        impersonated: Boolean(sessionActor?.impersonator),
        mintDocsSessionKey: async (input) => {
          try {
            return await mintDocsKey(input);
          } finally {
            resetDocsMint();
          }
        },
        succeeded: (notice) => feedback.succeeded(notice),
        failed: (failure) => feedback.failed(failure),
      }),
    [
      activeScope,
      graph,
      standing.data,
      refetchStanding,
      sessionActor,
      session,
      location,
      navigation,
      feedback,
      Switcher,
      mintToken,
      resetMint,
      mintDocsKey,
      resetDocsMint,
    ],
  );

  return <AuthorizeHostProvider value={host}>{children}</AuthorizeHostProvider>;
}
