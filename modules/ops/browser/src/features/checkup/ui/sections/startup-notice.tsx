import { checkupApi } from "../../behavior/checkup-api.ts";
import { useCheckupHost } from "../../model/checkup-host.ts";
import { StartupNoticeBanner } from "./startup-notice-banner.tsx";

/**
 * The one-time notice that this install reports usage, shown to administrators
 * of a self-hosted install once per schema version and dismissed into the
 * install's own database. Spec: specs/self-hosting/checkup/startup-notice.feature
 */
export function StartupNotice() {
  const host = useCheckupHost();
  const isSelfHosted = !host.isSaaS();
  const canManage = host.canManageOrganization();
  const organizationId = host.organizationId() ?? "";

  const notice = checkupApi.checkup.startupNotice.useQuery(
    { organizationId },
    {
      enabled: isSelfHosted && canManage && organizationId !== "",
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    },
  );

  if (!isSelfHosted || !canManage || !notice.data?.show) return null;

  return (
    <StartupNoticeBanner
      organizationId={organizationId}
      schemaVersion={notice.data.schemaVersion}
    />
  );
}

export default StartupNotice;
