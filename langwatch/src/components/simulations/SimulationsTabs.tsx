import { Tabs } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Grid, Table } from "lucide-react";
import type { ReactNode } from "react";

interface SimulationsTabsProps {
  gridView: ReactNode;
  tableView: ReactNode;
}

/**
 * Tab navigation component for switching between Grid View and Table View
 */
export function SimulationsTabs({ gridView, tableView }: SimulationsTabsProps) {
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
    <Tabs.Root
      value={currentView}
      onValueChange={handleTabChange}
      variant="line"
      size="md"
    >
      <Tabs.List mb={4}>
        <Tabs.Trigger value="grid">
          <Grid size={16} />
          Grid View
        </Tabs.Trigger>
        <Tabs.Trigger value="table">
          <Table size={16} />
          Table View
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="grid">{gridView}</Tabs.Content>
      <Tabs.Content value="table">{tableView}</Tabs.Content>
    </Tabs.Root>
  );
}
