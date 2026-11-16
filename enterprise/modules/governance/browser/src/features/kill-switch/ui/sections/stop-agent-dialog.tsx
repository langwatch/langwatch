// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Textarea, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";

import { useStopReason } from "../../behavior/use-stop-reason.ts";
import { useStopRequest } from "../../behavior/use-stop-request.ts";
import { StopPlanPreview } from "../blocks/stop-plan-preview.tsx";

function ReasonField({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <Field.Root invalid={error !== null} required>
      <Field.Label>Reason</Field.Label>
      <Textarea
        aria-label="Reason"
        value={value}
        maxLength={2000}
        placeholder="Leaking customer data in replies"
        onChange={(event) => onChange(event.target.value)}
      />
      <Field.HelperText>Kept in the audit log and sent with the webhook.</Field.HelperText>
      <Field.ErrorText>{error}</Field.ErrorText>
    </Field.Root>
  );
}

/**
 * Stopping an agent from the UI: it names every target the plan acts on and asks why. Confirm
 * waits for the plan read. A stop pressed here is immediate.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
export function StopAgentDialog({
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
  const reason = useStopReason();
  const request = useStopRequest({ organizationId, agentId, agentName, open });

  const close = () => {
    if (request.isStopping) return;
    reason.clear();
    request.reset();
    onClose();
  };

  const confirm = async () => {
    const trimmed = reason.take();
    if (!trimmed) return;
    request.reset();
    if (await request.requestStop({ reason: trimmed })) close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      role="alertdialog"
      placement="center"
      size="md"
      title={`Stop ${agentName}?`}
      description="This stops the agent where it runs, at once. You can restore it later."
      busy={request.isStopping}
      data-testid="stop-agent-dialog"
      primaryAction={{
        label: "Stop agent",
        danger: true,
        loading: request.isStopping,
        disabledReason: request.confirmBlockedReason,
        onClick: () => void confirm(),
      }}
    >
      <VStack align="stretch" gap={4}>
        {request.planChanged ? <HandledErrorAlert error={request.planChanged} /> : null}
        <StopPlanPreview
          targets={request.plan.targets}
          isLoading={request.plan.isLoading}
          error={request.plan.error}
          onRetry={request.plan.retry}
        />
        <ReasonField value={reason.value} error={reason.error} onChange={reason.change} />
      </VStack>
    </Dialog>
  );
}
