// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Dialog } from "@langwatch/design-system/dialog";
import { Separator, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { AGENT_STOP_PLAN_TARGETS_MAX } from "@langwatch/enterprise-governance-contract";
import { HandledErrorAlert } from "@langwatch/error-views";

import { useStopPlanEditor } from "../../behavior/use-stop-plan-editor.ts";
import { StopPlanTargetList } from "../blocks/stop-plan-target-list.tsx";
import { AwsConnectionsSection } from "./aws-connections-section.tsx";
import { StopTargetForm } from "./stop-target-form.tsx";

type Editor = ReturnType<typeof useStopPlanEditor>;

function StopPlanEditorBody({
  organizationId,
  editor,
}: {
  organizationId: string;
  editor: Editor;
}) {
  const { targets, awsConnections, sourcesFailure, connectionsFailure } = editor;
  return (
    <VStack align="stretch" gap={5}>
      {editor.conflict ? <HandledErrorAlert error={editor.conflict} /> : null}
      {sourcesFailure && (
        <HandledErrorAlert
          error={sourcesFailure.error}
          fallbackTitle="Couldn't load the Databricks sources"
          onRetry={sourcesFailure.retry}
        />
      )}
      {connectionsFailure && (
        <HandledErrorAlert
          error={connectionsFailure.error}
          fallbackTitle="Couldn't load the AWS connections"
          onRetry={connectionsFailure.retry}
        />
      )}
      <StopPlanTargetList
        targets={targets}
        labelOf={editor.labelOf}
        onRemove={(index) => editor.setTargets(targets.filter((_, at) => at !== index))}
        disabled={editor.isSaving}
      />
      <Separator />
      {targets.length >= AGENT_STOP_PLAN_TARGETS_MAX ? (
        <Text textStyle="sm" color="fg.muted">
          A plan holds at most {AGENT_STOP_PLAN_TARGETS_MAX} targets.
        </Text>
      ) : (
        <StopTargetForm
          databricksSources={editor.databricksSources}
          awsConnections={awsConnections.map((connection) => ({
            value: connection.id,
            label: connection.name,
          }))}
          onAdd={(target) => editor.setTargets([...targets, target])}
          disabled={editor.isSaving}
        />
      )}
      <Separator />
      <AwsConnectionsSection organizationId={organizationId} connections={awsConnections} />
    </VStack>
  );
}

/** The editor once the plan read succeeded; until then its failure with Retry, or a skeleton. */
function StopPlanDialogBody({
  organizationId,
  editor,
}: {
  organizationId: string;
  editor: Editor;
}) {
  if (editor.error) {
    return (
      <HandledErrorAlert
        error={editor.error}
        fallbackTitle="Couldn't load the stop plan"
        onRetry={editor.retry}
      />
    );
  }
  if (!editor.loaded) return <SkeletonRows rows={3} label="Loading the stop plan" />;
  return <StopPlanEditorBody organizationId={organizationId} editor={editor} />;
}

/**
 * An agent's stop plan: the targets a stop acts on, edited as a draft and saved whole. A failed
 * read shows with Retry and keeps Save shut.
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
  const editor = useStopPlanEditor({ organizationId, agentId, open });

  const close = () => {
    if (editor.isSaving) return;
    editor.discard();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={`Stop plan for ${agentName}`}
      description="What a stop of this agent turns off."
      busy={editor.isSaving}
      data-testid="stop-plan-dialog"
      primaryAction={{
        label: "Save plan",
        loading: editor.isSaving,
        disabledReason: editor.loaded ? undefined : "The stop plan has not loaded",
        onClick: () => void editor.submit().then((saved) => saved && onClose()),
      }}
    >
      <StopPlanDialogBody organizationId={organizationId} editor={editor} />
    </Dialog>
  );
}
