/**
 * What `apps/ui` mounts around every routed page.
 *
 * One place, three jobs: the transport a feature package's hooks run on, the
 * Providers those hooks need, and the capability ports a screen asks instead
 * of reaching for the document, the router or a toast singleton. A feature
 * that moves into this package declares all three in `createUiApplication`
 * and mounts nothing itself.
 *
 * It renders inside the root layout's error boundary, so a transport or
 * capability fault shows the page error fallback rather than blanking the
 * application.
 *
 * The capabilities resolve INNERMOST, below the QueryClient and every feature
 * Provider. A live session is four reads and a subscription to the address
 * bar, so the port that answers `hasPermission` can only be built where those
 * reads are legal — and a composition that installs no session source pays for
 * none of it and keeps the refusing default.
 */

import { QueryClient, QueryClientContext, QueryClientProvider } from "@tanstack/react-query";
import { useContext, useMemo, useState, type ReactNode } from "react";
import {
  BrowserUiDocumentTitle,
  resolveUiCapabilities,
  UiCapabilityContextProvider,
  UNAVAILABLE_UI_FEEDBACK,
  UNAVAILABLE_UI_SESSION,
  type UiCapabilityInstall,
  type UiSessionPort,
} from "../../behavior/ui-capabilities";
import {
  createUiFeatureApiClient,
  type UiFeatureApiBinding,
  type UiFeatureApiTransport,
} from "../../behavior/ui-feature-transport";
import { BrowserUiRpc, UiRpcContextProvider } from "../../behavior/ui-rpc";
import { useRouterUiNavigation, useRouterUiRoute } from "../../behavior/ui-router-navigation";
import type { UiSessionSource } from "../../behavior/ui-session";
import type { UiProviderShell } from "./ui-outer-providers";

export type UiFeatureShellInstall = {
  /** One entry per feature package whose hooks this application serves. */
  apis: readonly UiFeatureApiBinding[];
  /** The capability ports the composing application answers itself. */
  capabilities: UiCapabilityInstall;
  /** The transport those hooks run on. Built same-origin when absent. */
  transport?: UiFeatureApiTransport;
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

    return <UiCapabilityContextProvider value={resolved}>{children}</UiCapabilityContextProvider>;
  }

  return function UiFeatureShell({ children }: { children: ReactNode }) {
    // The host's QueryClient when this renders inside one, which is what makes
    // a feature's cache and the host's the same cache. Read through the
    // context rather than `useQueryClient()`, which throws when there is none
    // — a composition without a host transport is a legitimate shape, and the
    // fallback below is what serves it.
    const hostQueryClient = useContext(QueryClientContext);
    const [ownQueryClient] = useState(() => new QueryClient());
    const [ownTransport] = useState(() => transport ?? createUiFeatureApiClient());
    const queryClient = hostQueryClient ?? ownQueryClient;

    // The by-path dispatcher a screen too wide for a procedure map asks for.
    // Built here because this is where both halves of it are: the transport and
    // the QueryClient a feature may not reach for itself.
    const rpc = useMemo(
      () => BrowserUiRpc.create({ transport: ownTransport, queryClient }),
      [ownTransport, queryClient],
    );

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
