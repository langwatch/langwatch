import { useEffect } from "react";
import { useRouter } from "next/router";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";
import SettingsLayout from "../../components/SettingsLayout";
import { LangyMemorySettings } from "../../components/langy/LangyMemorySettings";

function LangyMemorySettingsPage() {
  const router = useRouter();
  const { data: session } = useRequiredSession();
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  const staff = isLangwatchStaff(session?.user?.email);
  const { enabled: langyFlagEnabled, isLoading: flagLoading } = useFeatureFlag(
    "release_langy_enabled",
    {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: !!project,
    },
  );

  const allowed = staff && langyFlagEnabled;

  useEffect(() => {
    if (session && !flagLoading && !allowed) {
      void router.replace("/settings");
    }
  }, [session, flagLoading, allowed, router]);

  if (!project) return null;
  if (!allowed) return null;
  return (
    <SettingsLayout>
      <LangyMemorySettings />
    </SettingsLayout>
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: SettingsLayout,
})(LangyMemorySettingsPage);
