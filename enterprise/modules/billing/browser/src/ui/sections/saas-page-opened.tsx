import { useRecordPageOpened } from "@langwatch/auth-client";

import { useBillingHost } from "../../model/billing-host.ts";

type BillingPage = Parameters<typeof useRecordPageOpened>[0]["page"];

function AnnouncedPage({ page }: { page: BillingPage }) {
  useRecordPageOpened({ page });
  return null;
}

/**
 * Announces a billing page's open from inside the deployment gate: a self-hosted
 * visitor, or one whose deployment has not answered yet, announces nothing.
 */
export function SaasPageOpened({ page }: { page: BillingPage }) {
  const host = useBillingHost();
  return host.isDeploymentSettled() && host.isSaaS() ? <AnnouncedPage page={page} /> : null;
}
