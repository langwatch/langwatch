/**
 * What the SCIM screen is mounted inside: the tRPC Provider its hooks run
 * on, and the host port for organization, SCIM base URL and feedback. The
 * base URL is the deployment's own `appBaseUrl`, not the browser's origin.
 */

import { ScimHostProvider, type ScimHostPort } from "@langwatch/enterprise-scim-web/screens/scim";
import { useMemo, type ReactNode } from "react";

import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";

/** Where a customer's identity provider posts. */
const SCIM_PATH = "/api/scim/v2";

function readScimBaseUrl(): string {
  try {
    return `${readPublicAppConfig().appBaseUrl.replace(/\/+$/, "")}${SCIM_PATH}`;
  } catch {
    return typeof window === "undefined" ? "" : `${window.location.origin}${SCIM_PATH}`;
  }
}

export function ScimHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { organizationId } = session.activeScope();

  const host = useMemo<ScimHostPort>(
    () => ({
      organizationId: () => organizationId ?? void 0,
      scimBaseUrl: () => readScimBaseUrl(),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [organizationId, feedback],
  );

  return <ScimHostProvider value={host}>{children}</ScimHostProvider>;
}
