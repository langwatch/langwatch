import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import SettingsLayout from "../../components/SettingsLayout";
import { LangyMemorySettings } from "../../components/langy/LangyMemorySettings";

function LangyMemorySettingsPage() {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  if (!project) return null;
  return (
    <SettingsLayout>
      <LangyMemorySettings />
    </SettingsLayout>
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: SettingsLayout,
})(LangyMemorySettingsPage);
