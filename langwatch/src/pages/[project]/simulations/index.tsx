import { Button, HStack, Tabs } from "@chakra-ui/react";
import { Grid, Table } from "lucide-react";
import { useRouter } from "next/router";
import React from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SimulationsGridView } from "~/components/simulations/SimulationsGridView";
import { ScenariosTableView } from "~/components/simulations/table-view/ScenariosTableView";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { ButtonToggleSlider } from "~/components/ui/ButtonToggleSlider";

function SimulationsPageContent() {
  const router = useRouter();
  const currentView = (router.query.view as string) ?? "grid";

  const handleTabChange = (details: { value: string }) => {
    const newView = details.value;
    const query = { ...router.query };

    if (newView === "grid") {
      delete query.view;
    } else {
      query.view = newView;
    }

    void router.replace({ query }, undefined, { shallow: true });
  };

  return (
    <DashboardLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <HStack justify="space-between" align="center" w="full">
            <PageLayout.Heading>Simulations</PageLayout.Heading>
            <ButtonToggleSlider.Root
              value={currentView}
              onChange={(value) => handleTabChange({ value })}
            >
              <ButtonToggleSlider.Button value="grid">
                <Grid size={16} />
                Grid View
              </ButtonToggleSlider.Button>
              <ButtonToggleSlider.Button value="table">
                <Table size={16} />
                Table View
              </ButtonToggleSlider.Button>
            </ButtonToggleSlider.Root>
          </HStack>
        </PageLayout.Header>

        <PageLayout.Content>
          {currentView === "grid" ? (
            <SimulationsGridView />
          ) : (
            <ScenariosTableView />
          )}
        </PageLayout.Content>
      </PageLayout.Container>
    </DashboardLayout>
  );
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SimulationsPageContent);
