import type { DashboardWidgetSource } from "@langwatch/analytics-contract/dashboard-widget-definition";

/**
 * Who made a widget through the REST API, told apart by the credential the request arrived
 * on: Langy's session key marks Langy's own widgets, any other credential is the API.
 */
export function widgetSourceOfCredential({
  credential,
}: {
  credential: { readonly type: string; readonly isLangySessionKey?: boolean };
}): DashboardWidgetSource {
  return credential.type === "apiKey" && credential.isLangySessionKey === true
    ? { kind: "langy" }
    : { kind: "api" };
}
