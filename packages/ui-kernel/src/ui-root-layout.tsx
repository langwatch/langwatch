/**
 * The root layout every route renders inside.
 */

import NProgress from "nprogress";
import { Suspense, useEffect, type ComponentType, type ReactNode } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { Outlet, useLocation, useNavigation } from "react-router";

import type { UiProviderShell } from "./ui-outer-providers";

export type UiRootLayoutInstall = {
  /** The providers that need router context. */
  innerProvider: UiProviderShell;
  /**
   * What this package mounts around the page: the browser transport its
   * feature packages run on, and the capability ports a screen asks. Inside
   * the error boundary, so a fault in either shows the page fallback.
   */
  featureShell: UiProviderShell;
  /**
   * Every installed module's declared host mounts, composed. Below the
   * feature shell because a host projects capabilities, and below the router
   * because a host reads the route. ARCHITECTURE.md §10.1.
   */
  moduleHosts: ComponentType<{ children?: ReactNode }>;
  /** Rendered when a page throws, reset when the pathname changes. */
  pageErrorFallback: ComponentType<FallbackProps>;
};

export function createUiRootLayout({
  innerProvider: InnerProviders,
  featureShell: FeatureShell,
  moduleHosts: ModuleHosts,
  pageErrorFallback,
}: UiRootLayoutInstall): ComponentType {
  return function UiRootLayout() {
    const navigation = useNavigation();
    const location = useLocation();

    useEffect(() => {
      NProgress.configure({ showSpinner: false });
    }, []);

    // The loading bar starts when a lazy route begins loading.
    useEffect(() => {
      if (navigation.state === "loading") {
        NProgress.start();
      } else {
        NProgress.done();
      }
    }, [navigation.state]);

    return (
      <InnerProviders>
        <ErrorBoundary FallbackComponent={pageErrorFallback} resetKeys={[location.pathname]}>
          <FeatureShell>
            <ModuleHosts>
              <Suspense>
                <Outlet />
              </Suspense>
            </ModuleHosts>
          </FeatureShell>
        </ErrorBoundary>
      </InnerProviders>
    );
  };
}
