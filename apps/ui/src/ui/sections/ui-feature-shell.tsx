/**
 * What `apps/ui` mounts around every routed page.
 */

import { BrowserUiStorage, setUiStorage } from "@langwatch/ui-host/storage";
import { setUiFeedbackHost } from "@langwatch/ui-host/toaster";
import { UiScopeHostProvider } from "@langwatch/ui-host/use-organization-team-project";
import {
  MutationCache,
  QueryClient,
  QueryClientContext,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useContext, useMemo, useState, type ReactNode } from "react";
import {
  BrowserUiDocumentTitle,
  resolveUiCapabilities,
  UiCapabilityContextProvider,
  UNAVAILABLE_UI_FEEDBACK,
  UNAVAILABLE_UI_SESSION,
  type UiCapabilityInstall,
  type UiSessionPort,
} from "@langwatch/ui-host/capabilities";
import { shouldRetryQuery } from "@langwatch/ui-host/query-retry";
import { UiSlot } from "@langwatch/ui-host/slots";
import {
  createUiFeatureApiClient,
  type UiFeatureApiBinding,
  type UiFeatureApiTransport,
} from "../../behavior/ui-feature-transport";
import type { UiFailureHost, UiFailureInterceptor } from "../../behavior/ui-feature";
import { BrowserUiRpc, UiRpcContextProvider } from "../../behavior/ui-rpc";
import { useRouterUiNavigation, useRouterUiRoute } from "../../behavior/ui-router-navigation";
import type { UiSessionSource } from "../../behavior/ui-session";
import type { UiProviderShell } from "./ui-outer-providers";

/** The device store the shell publishes to every feature. */
const SHELL_UI_STORAGE = new BrowserUiStorage();

export type UiFeatureShellInstall = {
  /** One entry per feature package whose hooks this application serves. */
  apis: readonly UiFeatureApiBinding[];
  /** The capability ports the composing application answers itself. */
  capabilities: UiCapabilityInstall;
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
};

/** The session of a composition that declared none. Refuses by name. */
const useUnavailableUiSession: UiSessionSource = () => UNAVAILABLE_UI_SESSION;

export function createUiFeatureShell({
  apis,
  capabilities,
  transport,
  failures = [],
  session,
}: UiFeatureShellInstall): UiProviderShell {
  // Chosen once per shell, never per render, so the hook it calls is the same
  // hook on every pass.
  const useSessionCapability = session ?? useUnavailableUiSession;

  function UiCapabilities({
    transport: sessionTransport,
    children,
  }: {
    transport: UiFeatureApiTransport;
    children: ReactNode;
  }) {
    const navigation = useRouterUiNavigation();
    const route = useRouterUiRoute();
    const [documentTitle] = useState(() => BrowserUiDocumentTitle.create());
    // The installed feedback port, resolved ahead of the session rather than
    // read back out of the resolution: a refused session read is told through
    // it, and it is the only failure with nobody else to tell.
    const sessionPort: UiSessionPort = useSessionCapability({
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
          session: sessionPort,
        }),
      [documentTitle, navigation, route, sessionPort],
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
        <UiScopeHostProvider value={resolved.session.scopeHost()}>
          {children}
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
    const [ownQueryClient] = useState(
      () =>
        new QueryClient({
          // A refusal the customer can act on is shown at once; only a failure
          // a replay could fix is replayed.
          defaultOptions: { queries: { retry: shouldRetryQuery } },
          mutationCache: new MutationCache({
            onError: (error) => reportFailure({ error, failures, host: failureHost.current }),
          }),
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
      <UiRpcContextProvider value={rpc}>
        <UiCapabilities transport={ownTransport}>{children}</UiCapabilities>
      </UiRpcContextProvider>,
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
      // oxlint-disable-next-line no-console
      console.error("A failure interceptor threw while reporting a failure:", interceptorError);
    }
  }
}
