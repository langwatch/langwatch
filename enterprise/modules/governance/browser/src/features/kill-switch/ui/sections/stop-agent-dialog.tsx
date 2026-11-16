// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Dialog } from "@langwatch/design-system/dialog";
import { Field, List, Text, Textarea, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "../../behavior/use-kill-switch.ts";
import { STOP_TARGET_KIND_LABELS } from "../../model/kill-switch-copy.ts";

/**
 * Stopping an agent from the UI: it names every target the plan acts on and asks why.
 * A stop pressed here is immediate. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
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
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const plan = api.governanceKillSwitch.plan.useQuery(
    { organizationId, agentId },
    { enabled: open && !!organizationId, refetchOnWindowFocus: false },
  );
  const stop = api.governanceKillSwitch.requestStop.useMutation();

  const close = () => {
    if (stop.isPending) return;
    setReason("");
    setReasonError(null);
    onClose();
  };

  const confirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError("Say why you are stopping this agent.");
      return;
    }
    try {
      await stop.mutateAsync({ organizationId, agentId, reason: trimmed });
      toaster.create({ title: `Stopping ${agentName}`, type: "success" });
      await refresh.afterStopChange();
      setReason("");
      onClose();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't stop the agent" });
    }
  };

  const targets = plan.data?.targets ?? [];

  return (
    <Dialog
      open={open}
      onClose={close}
      role="alertdialog"
      placement="center"
      size="md"
      title={`Stop ${agentName}?`}
      description="This stops the agent where it runs, at once. You can restore it later."
      busy={stop.isPending}
      data-testid="stop-agent-dialog"
      primaryAction={{
        label: "Stop agent",
        danger: true,
        loading: stop.isPending,
        onClick: () => void confirm(),
      }}
    >
      <VStack align="stretch" gap={4}>
        {plan.isPending ? (
          <SkeletonRows rows={2} label="Loading the stop plan" />
        ) : (
          <VStack align="stretch" gap={1}>
            <Text textStyle="sm" fontWeight="medium">
              {targets.length === 1
                ? "This stops 1 target"
                : `This stops ${targets.length} targets`}
            </Text>
            <List.Root paddingStart={5} data-testid="stop-agent-targets">
              {targets.map((row) => (
                <List.Item key={row.id} textStyle="sm">
                  {row.label}{" "}
                  <Text as="span" color="fg.muted">
                    ({STOP_TARGET_KIND_LABELS[row.target.kind]})
                  </Text>
                </List.Item>
              ))}
            </List.Root>
          </VStack>
        )}
        <Field.Root invalid={reasonError !== null} required>
          <Field.Label>Reason</Field.Label>
          <Textarea
            aria-label="Reason"
            value={reason}
            maxLength={2000}
            placeholder="Leaking customer data in replies"
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(null);
            }}
          />
          <Field.HelperText>Kept in the audit log and sent with the webhook.</Field.HelperText>
          <Field.ErrorText>{reasonError}</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Dialog>
  );
}
