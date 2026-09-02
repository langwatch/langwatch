/**
 * Where a reader goes to lift a plan limit, and what the button says.
 *
 * `~/hooks/usePlanManagementUrl` decided this from `usePublicEnv().IS_SAAS` —
 * the deployment's own shape, read off a meta tag the application writes — and
 * carried four more helpers for the usage page's limit formatting, none of
 * which this family reads. A feature package has no business reading the
 * deployment's shape, so the destination arrives on the host port and the
 * label follows from whether there is one at all: a SaaS deployment sends the
 * reader to a subscription, a self-hosted one to a license.
 *
 * The usage-page helpers did NOT travel. They belong to whichever family serves
 * the usage page.
 */

import { useLangyHost } from "../model/langy-host";

export function usePlanManagementUrl(): {
  url: string;
  buttonLabel: string;
  isSaaS: boolean;
  isLoading: boolean;
} {
  const url = useLangyHost().planManagementUrl();
  const isSaaS = url === "/settings/subscription";
  return {
    url: url ?? "/settings/license",
    buttonLabel: isSaaS ? "Upgrade plan" : "Upgrade license",
    isSaaS,
    isLoading: url === void 0,
  };
}
