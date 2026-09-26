/**
 * What `apps/ui` mounts around every routed page.
 */

import { BrowserUiRpc } from "@langwatch/browser-host/browser-rpc";
import {
  BrowserUiDocumentTitle,
  resolveUiCapabilities,
  UiCapabilityContextProvider,
  UNAVAILABLE_UI_FEEDBACK,
  UNAVAILABLE_UI_SCOPE,
  UNAVAILABLE_UI_SESSION,
  type UiCapabilityInstall,
  type UiRpc,
  type UiSessionCapabilities,
  type UiSessionSource,
} from "@langwatch/browser-host/capabilities";
import { CurrentDrawer, type UiDrawerRegistry } from "@langwatch/browser-host/drawer";
import { useRouterUiNavigation, useRouterUiRoute } from "@langwatch/browser-host/navigation";
import { createUiQueryClient } from "@langwatch/browser-host/query-client";
import { UiSlot } from "@langwatch/browser-host/slots";
import { BrowserUiStorage, setUiStorage } from "@langwatch/browser-host/storage";
import { setUiFeedbackHost } from "@langwatch/browser-host/toaster";
import {
  createUiFeatureApiClient,
  type UiFeatureApiBinding,
  type UiFeatureApiTransport,
} from "@langwatch/browser-host/transport";
import { UiScopeHostProvider } from "@langwatch/browser-host/use-organization-team-project";
import { QueryClientContext, QueryClientProvider } from "@tanstack/react-query";
import { useContext, useMemo, useState, type ComponentType, type ReactNode } from "react";

import { UiApiWaitingGate } from "./ui-api-waiting-gate.tsx";
import type { UiFailureHost, UiFailureInterceptor } from "./ui-feature-install.ts";
import type { UiProviderShell } from "./ui-outer-providers.tsx";

/** The device store the shell publishes to every feature. */
const SHELL_UI_STORAGE = new BrowserUiStorage();

export type UiFeatureShellInstall = {
  /** One entry per feature package whose hooks this application serves. */
  apis: readonly UiFeatureApiBinding[];
  /** The capability ports the composing application answers itself. */
  capabilities: UiCapabilityInstall;
  /** Every installed module's drawers, as one registry. */
  drawers?: UiDrawerRegistry;
  /**
   * Every installed module's host mounts, composed. They wrap the routed page
   * and the open drawer alike: a drawer reads the same `*HostApi` its screens do.
   */
  moduleHosts?: ComponentType<{ children?: ReactNode }>;
  /** The transport those hooks run on. Built same-origin when absent. */
  transport?: UiFeatureApiTransport;
  /**
   * Every feature's reader of a failed mutation, in install order. A failure a
   * feature answers application-wide is reported here once, rather than by
   * every screen that happens to trip it.
   */
  failures?: readonly UiFailureInterceptor[];
  /**
   * The live session this application reads for itself, when it has one to
   * read. `useBrowserUiSession` is the one this package ships.
   */
  session?: UiSessionSource;
  /** Whether this browser composition is a development build. */
  isDevelopment?: boolean;
  /**
   * The query key the composing application's session read is cached
   * under — auth's to name, supplied as data so this package names no
   * module. See `UiApiWaitingGate`.
   */
  sessionQueryKey: readonly unknown[];
};

/** A composition that installed no module host mounts. */
function UiNoModuleHosts({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

/** The session and scope of a composition that declared neither. Refuse by name. */
const useUnavailableUiSession: UiSessionSource = () => ({
  session: UNAVAILABLE_UI_SESSION,
  scope: UNAVAILABLE_UI_SCOPE,
});

export function createUiFeatureShell({
  apis,
  capabilities,
  drawers = {},
  moduleHosts: ModuleHosts = UiNoModuleHosts,
  transport,
  failures = [],
  session,
  isDevelopment = false,
  sessionQueryKey,
}: UiFeatureShellInstall): UiProviderShell {
  // Chosen once per shell, never per render, so the hook it calls is the same
  // hook on every pass.
  const useSessionCapability = session ?? useUnavailableUiSession;

  function UiCapabilities({
    transport: sessionTransport,
    rpc,
    children,
  }: {
    transport: UiFeatureApiTransport;
    rpc: UiRpc;
    children: ReactNode;
  }) {
    const navigation = useRouterUiNavigation();
    const route = useRouterUiRoute();
    const [documentTitle] = useState(() => BrowserUiDocumentTitle.create());
    // The installed feedback port, resolved ahead of the session rather than
    // read back out of the resolution: a refused session read is told through
    // it, and it is the only failure with nobody else to tell.
    const live: UiSessionCapabilities = useSessionCapability({
      transport: sessionTransport,
      feedback: capabilities.feedback ?? UNAVAILABLE_UI_FEEDBACK,
    });
    const resolved = useMemo(
      () =>
        resolveUiCapabilities({
          install: capabilities,
          documentTitle,
          navigation,
          route,
          rpc,
          scope: live.scope,
          session: live.session,
        }),
      [documentTitle, navigation, route, rpc, live],
    );

    // The toast and error singletons are called from mutation callbacks and
    // store actions, where no hook can run, so the resolved feedback port is
    // published to them here rather than read through the context.
    setUiFeedbackHost(resolved.feedback);
    setUiStorage(SHELL_UI_STORAGE);

    // The one scope host every feature's shared hook reads, on every route; a
    // session with nothing resolved publishes none and the hook reads unresolved.
    return (
      <UiCapabilityContextProvider value={resolved}>
        <UiScopeHostProvider value={resolved.scope?.scopeHost()}>
          {/* Nothing is answering on the API's address, so the reader waits
              here rather than being signed out of a stack that is booting. */}
          <UiApiWaitingGate isDevelopment={isDevelopment} sessionQueryKey={sessionQueryKey}>
            <ModuleHosts>
              {children}
              <CurrentDrawer drawers={drawers} isDevelopment={isDevelopment} />
            </ModuleHosts>
          </UiApiWaitingGate>
          {/* Always mounted, one gate for every routed page — a surface
              without this reach opened a limit dialog nobody ever saw. */}
          <UiSlot name="globalUpgradeModal" props={{}} />
        </UiScopeHostProvider>
      </UiCapabilityContextProvider>
    );
  }

  return function UiFeatureShell({ children }: { children: ReactNode }) {
    // The host's QueryClient when this renders inside one, which is what makes
    // a feature's cache and the host's the same cache. Read through the
    // context rather than `useQueryClient()`, which throws when there is none
    // — a composition without a host transport is a legitimate shape, and the
    // fallback below is what serves it.
    const hostQueryClient = useContext(QueryClientContext);
    const navigation = useRouterUiNavigation();
    // The interceptors are installed on a cache built once, but what they may
    // do about a failure is only knowable further down this render. The box
    // is what carries it there, and it refuses by name until it is filled.
    const [failureHost] = useState<{ current: UiFailureHost | null }>(() => ({ current: null }));
    const [ownQueryClient] = useState(() =>
      createUiQueryClient({
        onMutationError: (error) => reportFailure({ error, failures, host: failureHost.current }),
      }),
    );
    const [ownTransport] = useState(() => transport ?? createUiFeatureApiClient());
    const queryClient = hostQueryClient ?? ownQueryClient;

    // The by-path dispatcher a screen too wide for a procedure map asks for.
    // Built here because this is where both halves of it are: the transport and
    // the QueryClient a feature may not reach for itself.
    const rpc = useMemo(
      () => BrowserUiRpc.create({ transport: ownTransport, queryClient }),
      [ownTransport, queryClient],
    );
    failureHost.current = { rpc, navigate: (href: string) => navigation.navigate(href) };

    // Innermost first, so the list reads in mount order at the call site.
    const mounted = apis.reduceRight<ReactNode>(
      (inner, { Provider }) => (
        <Provider client={ownTransport} queryClient={queryClient}>
          {inner}
        </Provider>
      ),
      <UiCapabilities transport={ownTransport} rpc={rpc}>
        {children}
      </UiCapabilities>,
    );

    // Always mounted, host client or own: a Provider that appears only in one
    // of the two shapes changes the element type at this position, and React
    // answers that by remounting the whole routed subtree.
    return <QueryClientProvider client={queryClient}>{mounted}</QueryClientProvider>;
  };
}

/**
 * Runs every installed interceptor over one failed mutation. They all run: two
 * features answering the same failure both have something to say about it, and
 * one throwing must not silence the rest.
 */
function reportFailure({
  error,
  failures,
  host,
}: {
  error: unknown;
  failures: readonly UiFailureInterceptor[];
  host: UiFailureHost | null;
}): void {
  if (!host) return;
  for (const interceptor of failures) {
    try {
      interceptor(error, host);
    } catch (interceptorError) {
      console.error("A failure interceptor threw while reporting a failure:", interceptorError);
    }
  }
}
