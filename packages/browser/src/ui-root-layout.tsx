/**
 * The root layout every route renders inside.
 */

import { signalUiMounted } from "@langwatch/browser-host/navigation";
import NProgress from "nprogress";
import { Suspense, useEffect, type ComponentType } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { Outlet, useLocation, useNavigation } from "react-router";

import type { UiProviderShell } from "./ui-outer-providers";

export type UiRootLayoutInstall = {
  /** The providers that need router context. */
  innerProvider: UiProviderShell;
  /**
   * What this package mounts around the page: the browser transport its
   * feature packages run on, and the host service ports a screen asks. Inside
   * the error boundary, so a fault in either shows the page fallback.
   */
  featureShell: UiProviderShell;
  /** Rendered when a page throws, reset when the pathname changes. */
  pageErrorFallback: ComponentType<FallbackProps>;
};

export function createUiRootLayout({
  innerProvider: InnerProviders,
  featureShell: FeatureShell,
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
            <Suspense>
              <Outlet />
              <UiMountSignal />
            </Suspense>
          </FeatureShell>
        </ErrorBoundary>
      </InnerProviders>
    );
  };
}

/**
 * Commits with the first page, so only then does the boot recovery stand down: hosts and the
 * route chunk have loaded by now, and a failure before this is still worth a reload.
 */
function UiMountSignal() {
  useEffect(signalUiMounted, []);
  return null;
}
