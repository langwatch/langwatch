import { DashboardLayout } from "~/components/DashboardLayout";
import WelcomeLayout from "../../components/welcome/WelcomeLayout";
import { withPermissionGuard } from "../../components/WithPermissionGuard";

function SetupGuide() {
  return (
    <DashboardLayout>
      <WelcomeLayout />
    </DashboardLayout>
  );
}

export default withPermissionGuard("project:view", {
  layoutComponent: DashboardLayout,
})(SetupGuide);
