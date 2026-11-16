// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import {
  Badge,
  Button,
  Field,
  HStack,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import type { AgentStopView } from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

import { useStopDecisions } from "../../behavior/use-stop-decisions.ts";
import {
  STOP_SEVERITY_LABELS,
  STOP_SEVERITY_PALETTES,
  stopRequesterLabel,
} from "../../model/kill-switch-copy.ts";

function DenyStopDialog({
  stop,
  isDenying,
  onCancel,
  onDeny,
}: {
  stop: AgentStopView | null;
  isDenying: boolean;
  onCancel: () => void;
  onDeny: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={stop !== null}
      onClose={onCancel}
      placement="center"
      title={`Deny the stop of ${stop?.agentName ?? "this agent"}?`}
      description="The agent keeps running and nothing is turned off."
      busy={isDenying}
      primaryAction={{
        label: "Deny stop",
        loading: isDenying,
        onClick: () => onDeny(note),
      }}
    >
      <Field.Root>
        <Field.Label>Note</Field.Label>
        <Textarea
          aria-label="Note"
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Field.HelperText>Optional. Kept in the audit log.</Field.HelperText>
      </Field.Root>
    </Dialog>
  );
}

function ApprovalRow({
  stop,
  canManage,
  isApproving,
  onApprove,
  onDeny,
}: {
  stop: AgentStopView;
  canManage: boolean;
  isApproving: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <HStack
      justify="space-between"
      align="start"
      gap={4}
      data-testid="stop-approval-row"
      data-agent={stop.agentName}
    >
      <VStack align="start" gap={1} minWidth={0}>
        <HStack gap={2}>
          <Text textStyle="sm" fontWeight="semibold">
            {stop.agentName}
          </Text>
          <Badge size="xs" variant="subtle" colorPalette={STOP_SEVERITY_PALETTES[stop.severity]}>
            {STOP_SEVERITY_LABELS[stop.severity]}
          </Badge>
        </HStack>
        <Text textStyle="sm">{stop.reason}</Text>
        <Text textStyle="xs" color="fg.muted">
          Requested by {stopRequesterLabel(stop)}{" "}
          <FormattedDate value={stop.requestedAt} display="relative" />
        </Text>
      </VStack>
      {canManage ? (
        <HStack gap={2} flexShrink={0}>
          <Button size="xs" variant="outline" onClick={onDeny}>
            Deny
          </Button>
          <Button size="xs" colorPalette="red" loading={isApproving} onClick={onApprove}>
            Approve
          </Button>
        </HStack>
      ) : null}
    </HStack>
  );
}

/**
 * The stops waiting for a decision, at the top of the Agents page. Approving applies the plan;
 * a reader without governance:manage sees them without the buttons.
 */
export function StopApprovalsCard({
  organizationId,
  stops,
  canManage,
}: {
  organizationId: string;
  stops: readonly AgentStopView[];
  canManage: boolean;
}) {
  const [denying, setDenying] = useState<AgentStopView | null>(null);
  const decisions = useStopDecisions({ organizationId });

  const denyStop = async ({ stop, note }: { stop: AgentStopView; note: string }) => {
    if (await decisions.denyStop({ stop, note })) setDenying(null);
  };

  return (
    <Card
      title={
        stops.length === 1 ? "1 stop waits for approval" : `${stops.length} stops wait for approval`
      }
      description={canManage ? undefined : "A governance manager approves or denies these."}
      data-testid="stop-approvals-card"
    >
      <VStack align="stretch" gap={4}>
        {stops.map((stop) => (
          <ApprovalRow
            key={stop.id}
            stop={stop}
            canManage={canManage}
            isApproving={decisions.approvingStopId === stop.id}
            onApprove={() => void decisions.approveStop(stop)}
            onDeny={() => setDenying(stop)}
          />
        ))}
      </VStack>
      {denying ? (
        <DenyStopDialog
          key={denying.id}
          stop={denying}
          isDenying={decisions.isDenying}
          onCancel={() => setDenying(null)}
          onDeny={(note) => void denyStop({ stop: denying, note })}
        />
      ) : null}
    </Card>
  );
}
