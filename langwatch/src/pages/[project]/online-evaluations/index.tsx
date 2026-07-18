import {
  Box,
  Container,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Activity } from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { CopyMonitorDialog } from "~/components/evaluations/CopyMonitorDialog";
import { OnlineEvaluationHeaderActions } from "~/components/evaluations/OnlineEvaluationHeaderActions";
import {
  OnlineEvaluationsTable,
  type OnlineEvaluationRow,
} from "~/components/evaluations/OnlineEvaluationsTable";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

function OnlineEvaluationsPage() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const canManage = hasPermission("evaluations:manage");
  const canViewAnalytics = hasPermission("analytics:view");
  const [copyMonitor, setCopyMonitor] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [monitorToDelete, setMonitorToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const monitors = api.monitors.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );
  const performance = api.monitors.getPerformanceForProject.useQuery(
    {
      projectId: project?.id ?? "",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    { enabled: !!project && canViewAnalytics, refetchOnWindowFocus: false },
  );
  const experiments = api.experiments.getAllForEvaluationsList.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchOnWindowFocus: false },
  );

  const performanceByMonitor = useMemo(
    () =>
      new Map(
        performance.data?.map((item) => [item.monitorId, item] as const) ?? [],
      ),
    [performance.data],
  );
  const experimentSlugs = useMemo(
    () =>
      new Map(
        experiments.data?.experiments.map((experiment) => [
          experiment.id,
          experiment.slug,
        ]) ?? [],
      ),
    [experiments.data],
  );
  const rows: OnlineEvaluationRow[] =
    monitors.data?.map((monitor) => ({
      id: monitor.id,
      name: monitor.name,
      checkType: monitor.checkType,
      enabled: monitor.enabled,
      executionMode: monitor.executionMode,
      performance: performanceByMonitor.get(monitor.id),
    })) ?? [];

  const toggleMonitor = api.monitors.toggle.useMutation({
    onSuccess: () => {
      void monitors.refetch();
    },
  });
  const deleteMonitor = api.monitors.delete.useMutation({
    onSuccess: () => {
      void monitors.refetch();
      void performance.refetch();
      toaster.create({
        title: "Online evaluation deleted",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: () => {
      toaster.create({
        title: "Could not delete online evaluation",
        description: "Please try again.",
        type: "error",
        meta: { closable: true },
      });
    },
  });

  if (!project) return null;

  const monitorById = new Map(monitors.data?.map((monitor) => [monitor.id, monitor]));
  const editMonitor = (monitorId: string) => {
    const monitor = monitorById.get(monitorId);
    if (!monitor) return;

    const experimentSlug = monitor.experimentId
      ? experimentSlugs.get(monitor.experimentId)
      : undefined;
    if (experimentSlug) {
      void router.push(
        `/${project.slug}/experiments/workbench/${experimentSlug}`,
      );
      return;
    }

    openDrawer("onlineEvaluation", { monitorId });
  };

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Online Evaluations</PageLayout.Heading>
        <Spacer />
        <HStack gap={2}>
          <OnlineEvaluationHeaderActions />
        </HStack>
      </PageLayout.Header>

      {monitors.isLoading ? (
        <Box display="flex" justifyContent="center" paddingY={8}>
          <Spinner />
        </Box>
      ) : monitors.isError ? (
        <Box padding={6}>
          <Text color="red.500">Error loading online evaluations</Text>
        </Box>
      ) : rows.length === 0 ? (
        <PageLayout.Container>
          <PageLayout.Content>
            <NoDataInfoBlock
              title="No online evaluations yet"
              description="Score live traces and threads as they arrive, or set up a synchronous guardrail that can block unsafe traffic."
              icon={<Activity size={24} />}
              color="teal.500"
              docsInfo={
                <Text>
                  Learn more in the{" "}
                  <Link
                    color="teal.500"
                    href="https://langwatch.ai/docs/evaluations/online-evaluation/overview"
                    isExternal
                  >
                    online evaluations documentation
                  </Link>
                  .
                </Text>
              }
            >
              <HStack marginTop={4}>
                <OnlineEvaluationHeaderActions />
              </HStack>
            </NoDataInfoBlock>
          </PageLayout.Content>
        </PageLayout.Container>
      ) : (
        <Container
          maxW="calc(min(1440px, 100vw - 200px))"
          paddingX={6}
          paddingTop={4}
        >
          <VStack width="full" gap={4} align="stretch">
            <VStack align="start" gap={1}>
              <Text color="fg.muted">
                Online evaluations score live traces asynchronously. Guardrails
                run synchronously and can stop unsafe requests or responses.
              </Text>
            </VStack>
            <OnlineEvaluationsTable
              projectSlug={project.slug}
              rows={rows}
              canManage={canManage}
              canViewAnalytics={canViewAnalytics}
              onEdit={editMonitor}
              onReplicate={(monitorId) => {
                const monitor = monitorById.get(monitorId);
                if (monitor) {
                  setCopyMonitor({ id: monitor.id, name: monitor.name });
                }
              }}
              onToggle={(monitorId) => {
                const monitor = monitorById.get(monitorId);
                if (!monitor) return;
                toggleMonitor.mutate({
                  id: monitor.id,
                  projectId: project.id,
                  enabled: !monitor.enabled,
                });
              }}
              onDelete={(monitorId) => {
                const monitor = monitorById.get(monitorId);
                if (monitor) {
                  setMonitorToDelete({ id: monitor.id, name: monitor.name });
                }
              }}
            />
          </VStack>
        </Container>
      )}

      {copyMonitor && (
        <CopyMonitorDialog
          open
          onClose={() => setCopyMonitor(null)}
          monitorId={copyMonitor.id}
          monitorName={copyMonitor.name}
        />
      )}
      <ConfirmDialog
        open={!!monitorToDelete}
        onOpenChange={(open) => {
          if (!open) setMonitorToDelete(null);
        }}
        title="Delete online evaluation"
        message={`Are you sure you want to delete "${monitorToDelete?.name ?? ""}"?`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleteMonitor.isLoading}
        onConfirm={() => {
          if (!monitorToDelete) return;
          deleteMonitor.mutate(
            { id: monitorToDelete.id, projectId: project.id },
            { onSettled: () => setMonitorToDelete(null) },
          );
        }}
      />
    </DashboardLayout>
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: DashboardLayout,
})(OnlineEvaluationsPage);
