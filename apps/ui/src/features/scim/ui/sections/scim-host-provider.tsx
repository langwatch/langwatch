/**
 * What the SCIM screen is mounted inside.
 *
 * Two things go around `/settings/scim`: the tRPC Provider the package's own
 * hooks run on, and the host port that answers for the organization, the SCIM
 * base URL and the two notices.
 *
 * THE BASE URL IS THE DEPLOYMENT'S OWN, not `window.location.origin`. The
 * platform page composed it from the browser's address, which is right only as
 * long as nothing sits in front of the application; this deployment declares
 * `appBaseUrl` in its public config, and that is the address a customer's
 * identity provider will actually be configured with. A document with no config
 * falls back to the browser's origin, which is what the platform page did and
 * is better than an empty field.
 */

import { ScimHostProvider } from "@langwatch/enterprise-scim-web/screens/scim";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiScimHost } from "../../behavior/scim-host.adapter";

/** Where a customer's identity provider posts. */
const SCIM_PATH = "/api/scim/v2";

function readScimBaseUrl(): string {
  try {
    return `${readPublicAppConfig().appBaseUrl.replace(/\/+$/, "")}${SCIM_PATH}`;
  } catch {
    return typeof window === "undefined" ? "" : `${window.location.origin}${SCIM_PATH}`;
  }
}

function ScimHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { organizationId } = session.activeScope();

  const host = useMemo(
    () =>
      UiScimHost.create(
        { organizationId: organizationId ?? void 0, scimBaseUrl: readScimBaseUrl() },
        {
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [organizationId, feedback],
  );

  return <ScimHostProvider value={host}>{children}</ScimHostProvider>;
}

/** Wraps the SCIM screen in the host its package asks for. */
export function withScimHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <ScimHost>
      <Screen {...props} />
    </ScimHost>
  );
  Mounted.displayName = `withScimHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
