/**
 * What a front-door screen is mounted inside.
 *
 * Two things go around every `/auth/*` address and `/invite/accept`: the tRPC
 * Provider the package's own hooks run on, and the host port that answers for
 * the deployment and for the address.
 *
 * THE PATHNAME COMES OFF `useUiAddress`, not off the route reading.
 * `UiRoutePort` answers with path parameters and the query string, which is
 * what every family before this one needed; `useRequiredSession` asks a
 * different question — whether THIS address is one of the public ones — and
 * that needs the path. The ops family took the same route out for its
 * fragment-backed workspace, and for the same reason: `react-router` is sealed
 * off from `src/features/*`, and `behavior/ui-address.ts` is the seam.
 *
 * THE PUBLIC ENVIRONMENT IS THE SHELL'S. `readPublicAppConfig()` parses the
 * bootstrap the document was served with, which is the same read the
 * application's own `usePublicEnv` makes — so a screen that moved reads
 * exactly the deployment it read before. The per-viewer half (which sign-in
 * provider is configured, whether mail can be sent) is a query the package
 * makes for itself on this transport.
 */

import { AuthHostProvider } from "@langwatch/auth-web/screens/auth";
import { readPublicAppConfig, toPublicEnvironment } from "@langwatch/ui/public-config";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { useUiAddress } from "../../../../behavior/ui-address";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiAuthHost } from "../../behavior/auth-host.adapter";

function AuthHost({ children }: { children: ReactNode }) {
  const { route } = useUiCapabilities();
  const reading = route.reading();
  const address = useUiAddress();
  const pathname = address.split("?")[0]?.split("#")[0] ?? "/";

  const host = useMemo(
    () =>
      UiAuthHost.create({
        publicEnvironment: toPublicEnvironment(readPublicAppConfig()),
        route: { pathname, params: reading.params, query: reading.query },
      }),
    [pathname, reading.params, reading.query],
  );

  return <AuthHostProvider value={host}>{children}</AuthHostProvider>;
}

/** Wraps a front-door screen in the host its package asks for. */
export function withAuthHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <AuthHost>
      <Screen {...props} />
    </AuthHost>
  );
  Mounted.displayName = `withAuthHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
