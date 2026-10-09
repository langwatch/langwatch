import { useUiHostServices } from "@langwatch/browser-host/capabilities";

import { api } from "../../../behavior/ops-api.ts";
import { UpgradeBanner } from "./upgrade-banner.tsx";

/** The same grant the Upgrades pages sit behind. */
const OPS_VIEW_PERMISSION = "ops:view";

/** Where the banner's link lands: the Upgrades overview. */
export const UPGRADES_PATH = "/ops/upgrades";

/** The banner ops lends to the header: an operator's `ops.upgrade.status`, when it needs them. */
export function UpgradeHeaderBanner() {
  const { session } = useUiHostServices();
  if (!session.hasPermission(OPS_VIEW_PERMISSION)) return null;
  return <OperatorUpgradeBanner />;
}

/** Split out so a non-operator never issues the status read at all. */
function OperatorUpgradeBanner() {
  const { navigation } = useUiHostServices();
  const status = api.ops.upgrade.status.useQuery();
  return (
    <UpgradeBanner
      status={status.data}
      loading={status.isLoading}
      onOpen={() => navigation.navigate(UPGRADES_PATH)}
    />
  );
}
