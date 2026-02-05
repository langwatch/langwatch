import { Button, Heading, HStack, Input, Spacer, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isHandledByGlobalLicenseHandler } from "~/utils/trpcError";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";

export function DashboardNameDrawer({
  open = true,
  onClose,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const projectSlug = project?.slug ?? "";
  const { closeDrawer } = useDrawer();
  const { checkAndProceed } = useLicenseEnforcement("dashboards");
  const queryClient = api.useContext();

  const dashboardsQuery = api.dashboards.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const createDashboard = api.dashboards.create.useMutation();

  const dashboards = dashboardsQuery.data ?? [];
  const defaultName = `Dashboard ${dashboards.length + 1}`;

  const [dashboardName, setDashboardName] = useState(defaultName);

  useEffect(() => {
    if (!open) return;
    setDashboardName((current) => (current.trim() ? current : defaultName));
  }, [defaultName, open]);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      closeDrawer();
    }
  };

  const handleConfirm = () => {
    if (!dashboardName.trim()) return;

    checkAndProceed(() => {
      createDashboard.mutate(
        { projectId, name: dashboardName.trim() },
        {
          onSuccess: (newDashboard) => {
            void dashboardsQuery.refetch();
            void queryClient.licenseEnforcement.checkLimit.invalidate();
            void router.push(
              `/${projectSlug}/analytics/reports?dashboard=${newDashboard.id}`,
            );
            handleClose();
          },
          onError: (error) => {
            if (isHandledByGlobalLicenseHandler(error)) return;
            toaster.create({
              title: "Error creating dashboard",
              type: "error",
              duration: 3000,
              meta: { closable: true },
            });
          },
        },
      );
    });
  };

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="lg"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) {
          handleClose();
        }
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.CloseTrigger onClick={handleClose} />
          <Heading size="lg">Create Dashboard</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={6}>
            <HorizontalFormControl
              label="Name"
              helper="Give it a name that identifies what this dashboard will focus on"
            >
              <Input
                autoFocus
                placeholder="Dashboard name"
                value={dashboardName}
                onChange={(e) => setDashboardName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirm();
                }}
              />
            </HorizontalFormControl>
            <HStack width="full">
              <Spacer />
              <Button
                colorPalette="blue"
                onClick={handleConfirm}
                disabled={!dashboardName.trim()}
                loading={createDashboard.isPending}
              >
                Create Dashboard
              </Button>
            </HStack>
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
