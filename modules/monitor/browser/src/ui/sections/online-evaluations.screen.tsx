/**
 * `/:project/online-evaluations` — list and manage online evaluations
 * (pause, resume, replicate, delete). Creation and editing are handled by
 * platform/app drawers; analytics uses real links, not overlays.
 */

import { HStack, Skeleton, Spacer, Text, VStack } from "@chakra-ui/react";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Activity, Plus, Shield } from "lucide-react";
import { useState } from "react";

import { monitorApi } from "../../behavior/monitor-api.ts";
import { useOnlineEvaluations } from "../../behavior/use-online-evaluations.ts";
import { useMonitorHost } from "../../model/monitor-host.ts";
import { onlineEvaluationListState } from "../../model/online-evaluation-list-state.ts";
import { OnlineEvaluationsTable } from "../blocks/online-evaluations-table.tsx";
import { FullWidthListPageContent } from "../elements/full-width-list-page-content.tsx";
import { MonitorLink } from "../elements/monitor-link.tsx";
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
        data-testid="monitor-guardrail-open"
        onClick={() => host.openOverlay({ drawer: "guardrails" })}
      >
        <Shield size={16} />
        Set up Guardrail
      </PageLayout.HeaderButton>
      <PageLayout.HeaderButton
        background="bg"
        data-testid="monitor-new-open"
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

  const { monitors, performance, rows, monitorById, experimentSlugs } = useOnlineEvaluations({
    projectId,
    timeZone: host.timeZone(),
    canManage,
    canViewAnalytics,
    canViewExperiments,
  });

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

  const listState = onlineEvaluationListState({
    isLoading: monitors.isLoading,
    isError: monitors.isError,
    count: rows.length,
  });

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Online Evaluations</PageLayout.Heading>
        <Spacer />
        <HStack gap={2}>
          <HeaderActions canManage={canManage} />
        </HStack>
      </PageLayout.Header>

      {listState === "loading" && (
        <PageLayout.Container>
          <Skeleton height="200px" />
        </PageLayout.Container>
      )}
      {listState === "error" && (
        <PageLayout.Container>
          <Text color="red.500">Error loading online evaluations</Text>
        </PageLayout.Container>
      )}
      {listState === "empty" && (
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
      {listState === "list" && (
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
