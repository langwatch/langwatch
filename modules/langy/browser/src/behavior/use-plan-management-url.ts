/**
 * Where a reader goes to lift a plan limit, and what the button says.
 */

import { useUiDeployment } from "@langwatch/browser-host/capabilities";

import { useLangyHost } from "../model/langy-host.ts";

export function usePlanManagementUrl(): {
  url: string;
  buttonLabel: string;
  isSaaS: boolean;
  isLoading: boolean;
} {
  const url = useLangyHost().planManagementUrl();
  const { isSaaS } = useUiDeployment();
  return {
    url: url ?? "/settings/license",
    buttonLabel: isSaaS ? "Upgrade plan" : "Upgrade license",
    isSaaS,
    isLoading: url === void 0,
  };
}
