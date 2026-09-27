import { useEffect, useState } from "react";

import { useBillingHost } from "../../model/billing-host.ts";

/** Whether the page was returned to from a checkout, and from a plan change with credit. */
export function useCheckoutReturn() {
  const query = useBillingHost().routeQuery();
  const [showSuccess, setShowSuccess] = useState(false);
  const [showUpgradeCredit, setShowUpgradeCredit] = useState(false);

  useEffect(() => {
    if (query.success !== void 0) setShowSuccess(true);
    if (query.upgraded_from !== void 0) setShowUpgradeCredit(true);
  }, [query.success, query.upgraded_from]);

  return { showSuccess, showUpgradeCredit };
}
