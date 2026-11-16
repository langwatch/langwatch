// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Dialog } from "@langwatch/design-system/dialog";
import { Button, HStack, Separator, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import {
  AGENT_STOP_PLAN_TARGETS_MAX,
  type AgentStopTarget,
  DATABRICKS_GENIE_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "../../behavior/use-kill-switch.ts";
import { describeStopTarget, STOP_TARGET_KIND_LABELS } from "../../model/kill-switch-copy.ts";
import { AwsConnectionsSection } from "./aws-connections-section.tsx";
import { StopTargetForm } from "./stop-target-form.tsx";

/**
 * An agent's stop plan: the targets a stop acts on, edited as a draft and saved whole.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
export function StopPlanDialog({
  organizationId,
  agentId,
  agentName,
  open,
  onClose,
}: {
  organizationId: string;
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AgentStopTarget[] | null>(null);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const reads = { enabled: open && !!organizationId, refetchOnWindowFocus: false };
  const plan = api.governanceKillSwitch.plan.useQuery({ organizationId, agentId }, reads);
  const connections = api.governanceKillSwitch.awsConnections.useQuery({ organizationId }, reads);
  const sources = api.governanceAgents.syncSources.useQuery({ organizationId }, reads);
  const save = api.governanceKillSwitch.setPlan.useMutation();

  const saved = plan.data?.targets ?? [];
  const labelOf = (target: AgentStopTarget) =>
    saved.find((row) => JSON.stringify(row.target) === JSON.stringify(target))?.label ??
    describeStopTarget(target);
  const targets = draft ?? saved.map((row) => row.target);

  const close = () => {
    if (save.isPending) return;
    setDraft(null);
    onClose();
  };

  const submit = async () => {
    try {
      await save.mutateAsync({ organizationId, agentId, targets });
      toaster.create({ title: "Stop plan saved", type: "success" });
      await refresh.afterPlanChange({ agentId });
      setDraft(null);
      onClose();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't save the stop plan" });
    }
  };

  const databricksSources = (sources.data ?? [])
    .filter((source) => source.sourceType === DATABRICKS_GENIE_ADAPTER_ID)
    .map((source) => ({ value: source.id, label: source.name }));
  const awsConnections = connections.data ?? [];
  const full = targets.length >= AGENT_STOP_PLAN_TARGETS_MAX;

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={`Stop plan for ${agentName}`}
      description="What a stop of this agent turns off."
      busy={save.isPending}
      data-testid="stop-plan-dialog"
      primaryAction={{
        label: "Save plan",
        loading: save.isPending,
        disabledReason: plan.isPending ? "Loading the plan" : undefined,
        onClick: () => void submit(),
      }}
    >
      {plan.isPending ? (
        <SkeletonRows rows={3} label="Loading the stop plan" />
      ) : (
        <VStack align="stretch" gap={5}>
          <VStack align="stretch" gap={2} data-testid="stop-plan-targets">
            <Text textStyle="sm" fontWeight="semibold">
              Targets
            </Text>
            {targets.length === 0 ? (
              <Text textStyle="sm" color="fg.muted">
                No targets yet. Add one below so this agent can be stopped.
              </Text>
            ) : (
              targets.map((target, index) => (
                <HStack
                  key={`${index}-${target.kind}-${describeStopTarget(target)}`}
                  justify="space-between"
                  data-testid="stop-plan-target"
                >
                  <VStack align="start" gap={0}>
                    <Text textStyle="sm">{labelOf(target)}</Text>
                    <Text textStyle="xs" color="fg.muted">
                      {STOP_TARGET_KIND_LABELS[target.kind]}
                    </Text>
                  </VStack>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    aria-label={`Remove ${labelOf(target)}`}
                    onClick={() => setDraft(targets.filter((_, at) => at !== index))}
                  >
                    <Trash2 size={14} />
                  </Button>
                </HStack>
              ))
            )}
          </VStack>
          <Separator />
          {full ? (
            <Text textStyle="sm" color="fg.muted">
              A plan holds at most {AGENT_STOP_PLAN_TARGETS_MAX} targets.
            </Text>
          ) : (
            <StopTargetForm
              databricksSources={databricksSources}
              awsConnections={awsConnections.map((connection) => ({
                value: connection.id,
                label: connection.name,
              }))}
              onAdd={(target) => setDraft([...targets, target])}
            />
          )}
          <Separator />
          <AwsConnectionsSection organizationId={organizationId} connections={awsConnections} />
        </VStack>
      )}
    </Dialog>
  );
}
