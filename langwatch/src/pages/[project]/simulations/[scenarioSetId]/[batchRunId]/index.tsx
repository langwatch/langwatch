import { DashboardLayout } from "~/components/DashboardLayout";
import SimulationsPage from "~/components/suites/SimulationsPage";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SimulationsPage);
