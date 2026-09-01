/**
 * The root layout every route renders inside.
 *
 * Router-context providers, the navigation progress bar, the per-page error
 * boundary and the Suspense the lazy routes resolve into — the shape of the
 * page around whatever route matched.
 */

import NProgress from "nprogress";
import { Suspense, useEffect, type ComponentType } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { Outlet, useLocation, useNavigation } from "react-router";
import type { UiProviderShell } from "./ui-outer-providers";

export type UiRootLayoutInstall = {
  /** The providers that need router context. */
  innerProvider: UiProviderShell;
  /** Rendered when a page throws, reset when the pathname changes. */
  pageErrorFallback: ComponentType<FallbackProps>;
};

export function createUiRootLayout({
  innerProvider: InnerProviders,
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
          <Suspense>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </InnerProviders>
    );
  };
}
