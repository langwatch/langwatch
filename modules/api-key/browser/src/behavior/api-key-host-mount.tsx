/**
 * API Key's answer to the port its three screens declare, over
 * `@langwatch/browser-host` capabilities, this family's own `organization.getAll`
 * query, and the CLI device-flow's own REST doors. ARCHITECTURE.md §10.1.
 */

import { useUiAddress } from "@langwatch/browser-host/address";
import { useUiCapabilities, useUiScope } from "@langwatch/browser-host/capabilities";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useMemo, type ReactNode } from "react";

import {
  ApiKeyHostApi,
  ApiKeyHostProvider,
  type ApiKeyActor,
  type ApiKeyAvailableScopes,
  type ApiKeyFailureNotice,
  type ApiKeyHostScope,
  type ApiKeyOrganization,
  type ApiKeyPlatformDrawer,
  type ApiKeyRouteReading,
  type ApiKeySessionStatus,
  type ApiKeySuccessNotice,
  type CliDeviceActionResult,
  type CliDeviceApproval,
  type CliDeviceCodeLookup,
} from "../model/api-key-host.ts";
import { useApiKeyOrganizationGraph } from "./api-key-organization-graph.ts";
import { writeToClipboard } from "./browser-clipboard.ts";
import { approveCliDeviceCode, denyCliDeviceCode, lookupCliDeviceCode } from "./cli-device-flow.ts";

const LEAD_SOURCE_STORAGE_KEY = "lw_attrib.leadSource";

/**
 * Where the API a minted key will be used against lives. `UiDeployment`
 * carries no base-URL field, and a module may not read the shell's injected
 * config itself — this is the SaaS default until that capability widens.
 */
const DEFAULT_API_ENDPOINT = "https://app.langwatch.ai";

/**
 * The `#...` part of the address, without the hash. The screen re-scrolls to
 * `api-key-<id>` after its keys query resolves; `UiRoute` carries no fragment.
 */
function fragmentOf(address: string): string {
  const hash = address.indexOf("#");
  return hash === -1 ? "" : address.slice(hash + 1);
}

/**
 * Three states from two answers, order matters: `/cli/auth` bounces a
 * signed-out reader through SSO, so reading "not signed in" one render too
 * early would round-trip a signed-in reader.
 */
function sessionStatusOf(hasActor: boolean, isSettled: boolean): ApiKeySessionStatus {
  if (hasActor) return "authenticated";
  return isSettled ? "unauthenticated" : "loading";
}

class CapabilityApiKeyHost extends ApiKeyHostApi {
  constructor(
    private readonly deps: {
      activeScopeIds: { organizationId: string | undefined; projectId: string | undefined };
      graph: ReturnType<typeof useApiKeyOrganizationGraph>;
      actor: ApiKeyActor;
      hasPermission: (permission: string) => boolean;
      isSettled: boolean;
      reading: {
        params: Readonly<Record<string, string | undefined>>;
        query: Readonly<Record<string, string | undefined>>;
      };
      fragment: string;
      setQuery: (
        next: Readonly<Record<string, string | undefined>>,
        options?: { replace?: boolean },
      ) => void;
      navigate: (to: string) => void;
      replace: (to: string) => void;
      succeeded: (notice: ApiKeySuccessNotice) => void;
      failed: (failure: ApiKeyFailureNotice) => void;
      openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
    },
  ) {
    super();
  }

  scope(): ApiKeyHostScope {
    const { activeScopeIds, graph } = this.deps;
    return {
      organizationId: activeScopeIds.organizationId,
      organizationName: graph.organization?.name,
      teamId: graph.activeProject?.teamId,
      projectId: activeScopeIds.projectId,
      projectName: graph.activeProject?.project.name,
      projectSlug: graph.activeProject?.project.slug,
      projectApiKey: graph.activeProject?.project.apiKey ?? void 0,
    };
  }

  hasPermission(permission: string): boolean {
    return this.deps.hasPermission(permission);
  }

  availableScopes(): ApiKeyAvailableScopes {
    return this.deps.graph.availableScopes;
  }

  organizations(): ApiKeyOrganization[] | undefined {
    return this.deps.graph.hostOrganizations;
  }

  currentUser(): ApiKeyActor {
    return this.deps.actor;
  }

  sessionStatus(): ApiKeySessionStatus {
    return sessionStatusOf(this.deps.actor !== null, this.deps.isSettled);
  }

  apiEndpoint(): string {
    return DEFAULT_API_ENDPOINT;
  }

  route(): ApiKeyRouteReading {
    return { ...this.deps.reading, fragment: this.deps.fragment };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.setQuery(next, options);
  }

  replace(to: string): void {
    this.deps.replace(to);
  }

  navigate(to: string): void {
    this.deps.navigate(to);
  }

  succeeded(notice: ApiKeySuccessNotice): void {
    this.deps.succeeded(notice);
  }

  failed(failure: ApiKeyFailureNotice): void {
    this.deps.failed(failure);
  }

  async copyToClipboard(request: {
    text: string;
    succeeded: ApiKeySuccessNotice;
  }): Promise<boolean> {
    const ok = await writeToClipboard(request.text);
    if (ok) this.deps.succeeded(request.succeeded);
    return ok;
  }

  recordLeadSourceIfAbsent(source: string): void {
    if (typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem(LEAD_SOURCE_STORAGE_KEY) !== null) return;
      window.sessionStorage.setItem(LEAD_SOURCE_STORAGE_KEY, source);
    } catch {
      // Attribution is a nicety; a storage refusal is not the screen's failure.
      return;
    }
  }

  openPlatformDrawer(request: {
    drawer: ApiKeyPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    this.deps.openDrawer(request.drawer, { ...request.params });
  }

  lookupDeviceCode(userCode: string): Promise<CliDeviceCodeLookup> {
    return lookupCliDeviceCode(userCode);
  }

  approveDeviceCode(approval: CliDeviceApproval): Promise<CliDeviceActionResult> {
    return approveCliDeviceCode(approval);
  }

  denyDeviceCode(userCode: string): Promise<CliDeviceActionResult> {
    return denyCliDeviceCode(userCode);
  }
}

export default function ApiKeyHostMount({ children }: { children?: ReactNode }) {
  const { session, route, feedback, navigation } = useUiCapabilities();
  const activeScope = useUiScope().activeScope();
  const address = useUiAddress();
  const { openDrawer } = useDrawer();
  const graph = useApiKeyOrganizationGraph({
    organizationId: activeScope.organizationId ?? void 0,
    projectId: activeScope.projectId ?? void 0,
  });
  const sessionActor = session.currentUser();
  const reading = route.reading();

  const host = useMemo(
    () =>
      new CapabilityApiKeyHost({
        activeScopeIds: {
          organizationId: activeScope.organizationId ?? void 0,
          projectId: activeScope.projectId ?? void 0,
        },
        graph,
        actor: sessionActor ? { id: sessionActor.id } : null,
        hasPermission: (permission) => session.hasPermission(permission),
        isSettled: session.isSettled(),
        reading: { params: reading.params, query: reading.query },
        fragment: fragmentOf(address),
        setQuery: (next, options) => route.setQuery(next, options),
        navigate: (to) => navigation.navigate(to),
        replace: (to) => navigation.replace(to),
        succeeded: (notice) => feedback.succeeded(notice),
        failed: (failure) => feedback.failed(failure),
        openDrawer,
      }),
    [
      activeScope.organizationId,
      activeScope.projectId,
      graph,
      sessionActor,
      session,
      reading,
      address,
      route,
      navigation,
      feedback,
      openDrawer,
    ],
  );

  return <ApiKeyHostProvider value={host}>{children}</ApiKeyHostProvider>;
}
