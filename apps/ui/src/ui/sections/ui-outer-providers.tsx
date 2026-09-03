/**
 * The providers that wrap the router, in the order they have always nested.
 *
 * Session, transport and graphics quality still belong to the composing
 * application, so they arrive as components; the Design System shell is this
 * package's own. The order lives here and only here — a host supplies what it
 * still owns and never decides where it sits.
 */

import type { ComponentType, ReactNode } from "react";
import { uiDesignSystem } from "../../behavior/design-system";
import { UiDesignSystemShell } from "./ui-design-system-shell";

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
};

export function createUiOuterProvider({
  attribution: Attribution,
  session: Session,
  transport: Transport,
  graphicsQuality: GraphicsQuality,
}: UiOuterProviderInstall): UiProviderShell {
  return function UiOuterProviders({ children }: { children: ReactNode }) {
    return (
      <Attribution>
        <Session>
          <Transport>
            <UiDesignSystemShell system={uiDesignSystem}>
              <GraphicsQuality>{children}</GraphicsQuality>
            </UiDesignSystemShell>
          </Transport>
        </Session>
      </Attribution>
    );
  };
}
