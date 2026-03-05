import { Spinner } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { PlansComparisonPage } from "../../components/plans/PlansComparisonPage";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

function PlansPage() {
  const { organization } = useOrganizationTeamProject();
  const activePlan = api.plan.getActivePlan.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled: !!organization?.id,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  if (activePlan.isLoading && !activePlan.data) {
    return (
      <SettingsLayout>
        <Spinner />
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <PlansComparisonPage
        activePlan={activePlan.data}
        pricingModel={organization?.pricingModel}
      />
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:view", {
  layoutComponent: SettingsLayout,
})(PlansPage);
