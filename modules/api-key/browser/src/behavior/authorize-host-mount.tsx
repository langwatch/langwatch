/**
 * The two handoff screens' answer to their port, over `@langwatch/browser-host`
 * capabilities and this family's own `organization.getAll` query.
 * ARCHITECTURE.md §10.1.
 */

import { ApiKeyScopeViolationError } from "@langwatch/api-key-contract";
import {
  useUiCapabilities,
  useUiDeclarations,
  useUiScope,
} from "@langwatch/browser-host/capabilities";
import type { UiProjectSwitcherProps } from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo, type ComponentType, type ReactNode } from "react";
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
import { cappedDeviceFlowPermissions, projectTokenInput } from "../model/project-token-input.ts";
import { apiKeyApi } from "./api-key-api.ts";
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
      mintProjectToken: () => Promise<string | undefined>;
      Switcher: ComponentType<UiProjectSwitcherProps> | undefined;
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

  mintProjectToken(): Promise<string | undefined> {
    return this.deps.mintProjectToken();
  }

  /** The switcher project lends by declaration (ARCHITECTURE §10), drawn inside the card. */
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
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so the switcher is not remounted.
  const Switcher = useMemo(() => {
    const [lent] = declarations.declared("projectSwitcher");
    return lent ? lazy(lent.capability.load) : void 0;
  }, [declarations]);

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
        mintProjectToken: async () => {
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
            return (await mintToken(projectTokenInput({ organizationId, projectId, permissions })))
              .token;
          } finally {
            resetMint();
          }
        },
        Switcher,
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
    ],
  );

  return <AuthorizeHostProvider value={host}>{children}</AuthorizeHostProvider>;
}
