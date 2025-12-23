import { Button, HStack } from "@chakra-ui/react";
import React from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Tabs } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Grid, Table } from "lucide-react";
import { SimulationsGridView } from "~/components/simulations/SimulationsGridView";
import { ScenariosTableView } from "~/components/simulations/table-view/ScenariosTableView";

function SimulationsPageContent() {
  const router = useRouter();
  const currentView = (router.query.view as string) ?? "grid";
  const isGridView = currentView === "grid";
  const isTableView = !isGridView;

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
      <PageLayout.Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
      >
        <PageLayout.Header>
          <HStack justify="space-between" align="center" w="full">
            <PageLayout.Heading>Simulations</PageLayout.Heading>
          </HStack>
        </PageLayout.Header>

        <Tabs.Root
          value={currentView}
          onValueChange={handleTabChange}
          variant="line"
          size="md"
        >
          <Tabs.List
            mb={4}
            gap={0}
            borderColor="gray.50"
            backgroundColor="gray.50"
            width="fit-content"
            rounded="lg"
          >
            <Tabs.Trigger value="grid">
              <Button
                variant={isGridView ? "solid" : "outline"}
                colorPalette={isGridView ? "orange" : "gray"}
              >
                <Grid size={16} />
                Grid View
              </Button>
            </Tabs.Trigger>
            <Tabs.Trigger value="table">
              <Button
                variant={isTableView ? "solid" : "outline"}
                colorPalette={isTableView ? "orange" : "gray"}
              >
                <Table size={16} />
                Table View
              </Button>
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="grid">
            <SimulationsGridView />
          </Tabs.Content>
          <Tabs.Content value="table">
            <ScenariosTableView />
          </Tabs.Content>
        </Tabs.Root>
      </PageLayout.Container>
    </DashboardLayout>
  );
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SimulationsPageContent);
