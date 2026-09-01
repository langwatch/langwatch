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
 */

import { QueryClient, QueryClientContext, QueryClientProvider } from "@tanstack/react-query";
import { useContext, useMemo, useState, type ReactNode } from "react";
import {
  BrowserUiDocumentTitle,
  resolveUiCapabilities,
  UiCapabilityContextProvider,
  type UiCapabilityInstall,
} from "../../behavior/ui-capabilities";
import {
  createUiFeatureApiClient,
  type UiFeatureApiBinding,
  type UiFeatureApiTransport,
} from "../../behavior/ui-feature-transport";
import { useRouterUiNavigation } from "../../behavior/ui-router-navigation";
import type { UiProviderShell } from "./ui-outer-providers";

export type UiFeatureShellInstall = {
  /** One entry per feature package whose hooks this application serves. */
  apis: readonly UiFeatureApiBinding[];
  /** The capability ports the composing application answers itself. */
  capabilities: UiCapabilityInstall;
  /** The transport those hooks run on. Built same-origin when absent. */
  transport?: UiFeatureApiTransport;
};

export function createUiFeatureShell({
  apis,
  capabilities,
  transport,
}: UiFeatureShellInstall): UiProviderShell {
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

    const navigation = useRouterUiNavigation();
    const [documentTitle] = useState(() => BrowserUiDocumentTitle.create());
    const resolved = useMemo(
      () => resolveUiCapabilities({ install: capabilities, documentTitle, navigation }),
      [documentTitle, navigation],
    );

    // Innermost first, so the list reads in mount order at the call site.
    const mounted = apis.reduceRight<ReactNode>(
      (inner, { Provider }) => (
        <Provider client={ownTransport} queryClient={queryClient}>
          {inner}
        </Provider>
      ),
      <UiCapabilityContextProvider value={resolved}>{children}</UiCapabilityContextProvider>,
    );

    // Always mounted, host client or own: a Provider that appears only in one
    // of the two shapes changes the element type at this position, and React
    // answers that by remounting the whole routed subtree.
    return <QueryClientProvider client={queryClient}>{mounted}</QueryClientProvider>;
  };
}
