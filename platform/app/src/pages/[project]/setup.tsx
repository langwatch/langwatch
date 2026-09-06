import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import WelcomeLayout from "../../components/welcome/WelcomeLayout";

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
