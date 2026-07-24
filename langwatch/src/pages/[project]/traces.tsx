import { DashboardLayout } from "../../components/DashboardLayout";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { TracesPage } from "../../features/traces-v2/components/TracesPage";

function TracesV2Page() {
  return (
    <DashboardLayout>
      <TracesPage />
    </DashboardLayout>
  );
}

export default withPermissionGuard("traces:view", {
  layoutComponent: DashboardLayout,
})(TracesV2Page);
