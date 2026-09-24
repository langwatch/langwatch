/**
 * `/:project/online-evaluations` — list and manage online evaluations
 * (pause, resume, replicate, delete). Creation and editing are handled by
 * platform/app drawers; analytics uses real links, not overlays.
 */

import { Box, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { isLegacyOnlineEvaluationWorkbenchState } from "@langwatch/experiment-contract";
import { Activity, Plus, Shield } from "lucide-react";
import { useMemo, useState } from "react";

import { monitorApi } from "../../behavior/monitor-api.ts";
import { useMonitorHost } from "../../model/monitor-host.ts";
import {
  OnlineEvaluationsTable,
  type OnlineEvaluationRow,
} from "../blocks/online-evaluations-table.tsx";
import { FullWidthListPageContent } from "../elements/full-width-list-page-content.tsx";
import { MonitorLink } from "../elements/monitor-link.tsx";
import { NoDataInfoBlock } from "../elements/no-data-info-block.tsx";
import { MonitorReplicateDialog } from "./monitor-replicate-dialog.tsx";

const DOCS_URL = "https://langwatch.ai/docs/evaluations/online-evaluation/overview";

type MonitorRef = { id: string; name: string };

/** The two actions the page header offers, both of them application overlays. */
function HeaderActions({ canManage }: { canManage: boolean }) {
  const host = useMonitorHost();
  if (!canManage) return null;

  return (
    <>
      <PageLayout.HeaderButton
        background="bg"
        onClick={() => host.openOverlay({ drawer: "guardrails" })}
      >
        <Shield size={16} />
        Set up Guardrail
      </PageLayout.HeaderButton>
      <PageLayout.HeaderButton
        background="bg"
        onClick={() => host.openOverlay({ drawer: "onlineEvaluation" })}
      >
        <Plus size={16} />
        New Online Evaluation
      </PageLayout.HeaderButton>
    </>
  );
}

export default function OnlineEvaluationsScreen() {
  const host = useMonitorHost();
  const { projectId, projectSlug } = host.scope();
  const canManage = host.hasPermission("evaluations:manage");
  const canViewAnalytics = host.hasPermission("analytics:view");
  const canViewExperiments = host.hasPermission("experiments:view");

  const [copyMonitor, setCopyMonitor] = useState<MonitorRef | null>(null);
  const [monitorToDelete, setMonitorToDelete] = useState<MonitorRef | null>(null);

  const monitors = monitorApi.monitors.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const performance = monitorApi.monitors.getPerformanceForProject.useQuery(
    { projectId: projectId ?? "", timeZone: host.timeZone() },
    {
      enabled: !!projectId && canViewAnalytics && monitors.isSuccess,
      refetchOnWindowFocus: false,
      trpc: { context: { skipBatch: true } },
    },
  );

  const experiments = monitorApi.experiments.getAllByProjectId.useQuery(
    { projectId: projectId ?? "" },
    {
      enabled: !!projectId && canManage && canViewExperiments && monitors.isSuccess,
      refetchOnWindowFocus: false,
      trpc: { context: { skipBatch: true } },
    },
  );

  const performanceByMonitor = useMemo(
    () => new Map(performance.data?.map((item) => [item.monitorId, item] as const) ?? []),
    [performance.data],
  );

  const experimentSlugs = useMemo(
    () =>
      new Map(
        (experiments.data ?? [])
          .filter((experiment) => isLegacyOnlineEvaluationWorkbenchState(experiment.workbenchState))
          .map((experiment) => [experiment.id, experiment.slug] as const),
      ),
    [experiments.data],
  );

  const monitorById = useMemo(
    () => new Map((monitors.data ?? []).map((monitor) => [monitor.id, monitor] as const)),
    [monitors.data],
  );

  const rows: OnlineEvaluationRow[] =
    monitors.data?.map((monitor) => ({
      id: monitor.id,
      name: monitor.name,
      checkType: monitor.checkType,
      enabled: monitor.enabled,
      executionMode: monitor.executionMode,
      performance: performanceByMonitor.get(monitor.id),
      hasPerformanceError: performance.isError,
    })) ?? [];

  const toggleMonitor = monitorApi.monitors.toggle.useMutation({
    onSuccess: () => {
      void monitors.refetch();
    },
  });

  const deleteMonitor = monitorApi.monitors.delete.useMutation({
    onSuccess: () => {
      void monitors.refetch();
      if (canViewAnalytics) void performance.refetch();
      host.succeeded({ title: "Online evaluation deleted" });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete online evaluation" }),
  });

  if (!projectId || !projectSlug) return null;

  const editMonitor = (monitorId: string) => {
    const monitor = monitorById.get(monitorId);
    if (!monitor) return;

    const experimentSlug = monitor.experimentId
      ? experimentSlugs.get(monitor.experimentId)
      : undefined;
    if (experimentSlug) {
      host.navigate(`/${projectSlug}/experiments/workbench/${experimentSlug}`);
      return;
    }

    host.openOverlay({ drawer: "onlineEvaluation", params: { monitorId } });
  };

  const isLoadingMonitors = monitors.isLoading;
  const showMonitorsError = !isLoadingMonitors && monitors.isError;
  const showMonitorsEmpty = !isLoadingMonitors && !monitors.isError && rows.length === 0;
  const showMonitors = !isLoadingMonitors && !monitors.isError && rows.length !== 0;

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Online Evaluations</PageLayout.Heading>
        <Spacer />
        <HStack gap={2}>
          <HeaderActions canManage={canManage} />
        </HStack>
      </PageLayout.Header>

      {isLoadingMonitors && (
        <Box display="flex" justifyContent="center" paddingY={8}>
          <Spinner />
        </Box>
      )}
      {showMonitorsError && (
        <Box padding={6}>
          <Text color="red.500">Error loading online evaluations</Text>
        </Box>
      )}
      {showMonitorsEmpty && (
        <PageLayout.Container>
          <PageLayout.Content>
            <NoDataInfoBlock
              title="No online evaluations yet"
              description="Score live traces and threads as they arrive, or set up a synchronous guardrail that can block unsafe traffic."
              icon={<Activity size={24} />}
              docsInfo={
                <Text>
                  Learn more in the{" "}
                  <MonitorLink
                    href={DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "inherit", textDecoration: "underline" }}
                  >
                    online evaluations documentation
                  </MonitorLink>
                  .
                </Text>
              }
            >
              <HStack marginTop={4}>
                <HeaderActions canManage={canManage} />
              </HStack>
            </NoDataInfoBlock>
          </PageLayout.Content>
        </PageLayout.Container>
      )}
      {showMonitors && (
        <FullWidthListPageContent>
          <VStack width="full" gap={4} align="stretch">
            <VStack align="start" gap={1}>
              <Text color="fg.muted">
                Online evaluations score live traces asynchronously. Guardrails run synchronously
                and can stop unsafe requests or responses.
              </Text>
            </VStack>
            <OnlineEvaluationsTable
              projectSlug={projectSlug}
              rows={rows}
              canManage={canManage}
              canViewAnalytics={canViewAnalytics}
              onEdit={editMonitor}
              onReplicate={(monitorId) => {
                const monitor = monitorById.get(monitorId);
                if (monitor) setCopyMonitor({ id: monitor.id, name: monitor.name });
              }}
              onToggle={(monitorId) => {
                const monitor = monitorById.get(monitorId);
                if (!monitor) return;
                toggleMonitor.mutate({
                  id: monitor.id,
                  projectId,
                  enabled: !monitor.enabled,
                });
              }}
              onDelete={(monitorId) => {
                const monitor = monitorById.get(monitorId);
                if (monitor) setMonitorToDelete({ id: monitor.id, name: monitor.name });
              }}
            />
          </VStack>
        </FullWidthListPageContent>
      )}

      {copyMonitor && (
        <MonitorReplicateDialog
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
        loading={deleteMonitor.isPending}
        onConfirm={() => {
          if (!monitorToDelete) return;
          deleteMonitor.mutate(
            { id: monitorToDelete.id, projectId },
            { onSettled: () => setMonitorToDelete(null) },
          );
        }}
      />
    </>
  );
}
