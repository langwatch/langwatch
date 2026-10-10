/**
 * The providers that wrap the router, in the order they have always nested.
 */

import {
  DesignSystemProvider,
  type DesignSystemProviderProps,
} from "@langwatch/design-system/provider";
import type { ComponentType, ReactNode } from "react";

export type UiDesignSystemShellProps = DesignSystemProviderProps;

export function UiDesignSystemShell(props: UiDesignSystemShellProps) {
  return <DesignSystemProvider {...props} />;
}

/** Anything the application installs at a provider position. */
export type UiProviderShell = ComponentType<{ children: ReactNode }>;

export type UiOuterProviderInstall = {
  /**
   * Runs at the outermost mount point, before any navigation can drop a query
   * string — which is what first-touch attribution needs, on every landing URL
   * including the unauthenticated ones.
   */
  attribution: UiProviderShell;
  session: UiProviderShell;
  transport: UiProviderShell;
  graphicsQuality: UiProviderShell;
  /**
   * The composed system (shared foundations plus installed features) —
   * composition's to build, since it names every installed module's theme.
   * Absent falls back to the design system package's own default.
   */
  designSystem?: UiDesignSystemShellProps["system"];
};

export function createUiOuterProvider({
  attribution: Attribution,
  session: Session,
  transport: Transport,
  graphicsQuality: GraphicsQuality,
  designSystem,
}: UiOuterProviderInstall): UiProviderShell {
  return function UiOuterProviders({ children }: { children: ReactNode }) {
    return (
      <Attribution>
        <Session>
          <Transport>
            <UiDesignSystemShell system={designSystem}>
              <GraphicsQuality>{children}</GraphicsQuality>
            </UiDesignSystemShell>
          </Transport>
        </Session>
      </Attribution>
    );
  };
}
