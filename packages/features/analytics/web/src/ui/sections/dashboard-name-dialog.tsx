/**
 * Naming a new dashboard.
 *
 * `platform/app`'s `DashboardNameDrawer`, mounted INLINE by the section that
 * offers it rather than through the drawer registry. That registry is
 * application chrome a packaged screen has nothing above it to supply, and this
 * overlay had exactly one opener, so it travels as a dialog and its registry
 * entry is deleted with it — the gateway family's routing-policy shape.
 *
 * A drawer became a dialog: the sheet slid in from the edge to ask for one
 * word, which is what a dialog is for. Nothing else about it changed — the
 * default name still counts the existing dashboards, Enter still confirms, and
 * creating still lands the reader on the new dashboard.
 */

import { Button, HStack, Input, Spacer, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { Dialog } from "@langwatch/design-system/dialog";

import { useAnalyticsHost } from "../../model/analytics-host";
import { analyticsApi } from "../../behavior/analytics-api";

export function DashboardNameDialog({
  open,
  onOpenChange,
  projectSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
}) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";

  const dashboardsQuery = analyticsApi.dashboards.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const createDashboard = analyticsApi.dashboards.create.useMutation();

  const dashboards = dashboardsQuery.data ?? [];
  const defaultName = `Dashboard ${dashboards.length + 1}`;

  const [dashboardName, setDashboardName] = useState(defaultName);

  useEffect(() => {
    if (!open) return;
    setDashboardName((current) => (current.trim() ? current : defaultName));
  }, [defaultName, open]);

  const handleConfirm = () => {
    if (!dashboardName.trim()) return;

    createDashboard.mutate(
      { projectId, name: dashboardName.trim() },
      {
        onSuccess: (newDashboard) => {
          void dashboardsQuery.refetch();
          host.navigate(`/${projectSlug}/analytics/reports?dashboard=${newDashboard.id}`);
          onOpenChange(false);
        },
        // The words a reader sees come from the host's code-keyed registry, so
        // the raw error travels and this only names what was being attempted.
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't create this dashboard" }),
      },
    );
  };

  return (
    <Dialog.Root open={open} size="sm" onOpenChange={({ open: isOpen }) => onOpenChange(isOpen)}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Create dashboard</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={2}>
            <Text textStyle="sm" color="fg.muted">
              Give it a name that identifies what this dashboard will focus on.
            </Text>
            <Input
              autoFocus
              aria-label="Dashboard name"
              placeholder="Dashboard name"
              value={dashboardName}
              onChange={(event) => setDashboardName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleConfirm();
              }}
            />
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              colorPalette="blue"
              onClick={handleConfirm}
              disabled={!dashboardName.trim()}
              loading={createDashboard.isPending}
            >
              Create dashboard
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
