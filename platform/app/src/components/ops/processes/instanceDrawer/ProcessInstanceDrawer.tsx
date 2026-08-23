import { Button, CodeBlock, HStack, Spacer, Text } from "@chakra-ui/react";
import { useState } from "react";
import { LuCopy } from "react-icons/lu";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { useColorMode } from "~/components/ui/color-mode";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { useShikiAdapter } from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";
import { useDrawer } from "~/hooks/useDrawer";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import { ProcessInstanceContent } from "./ProcessInstanceContent";
import { useProcessInstanceActions } from "./useProcessInstanceActions";

interface Props {
  processName?: string;
  projectId?: string;
  processKey?: string;
}

const OUTBOX_PAGE_SIZE = 20;

function InstanceDrawerTitle({
  label,
  onCopyKey,
}: {
  label: string;
  onCopyKey: () => void;
}) {
  return (
    <HStack width="full" gap={2} align="start">
      <Text textStyle="sm" fontFamily="mono" wordBreak="break-all">
        {label}
      </Text>
      <Button
        size="2xs"
        variant="ghost"
        aria-label="Copy process key"
        onClick={onCopyKey}
        flexShrink={0}
      >
        <LuCopy size={12} />
      </Button>
      <Spacer />
    </HStack>
  );
}

function InstanceDrawerActions({
  actions,
}: {
  actions: ReturnType<typeof useProcessInstanceActions>;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        colorPalette="blue"
        onClick={() => actions.setConfirmAction("wake")}
      >
        Wake now
      </Button>
      <Button
        variant="outline"
        size="sm"
        colorPalette="green"
        onClick={() => actions.setConfirmAction("redrive")}
      >
        Redrive dead messages
      </Button>
    </>
  );
}

function InstanceActionConfirms({
  target,
  label,
  actions,
}: {
  target: { processName: string; projectId: string; processKey: string };
  label: string;
  actions: ReturnType<typeof useProcessInstanceActions>;
}) {
  return (
    <>
      <ConfirmDialog
        open={actions.confirmAction === "wake"}
        onClose={() => actions.setConfirmAction(null)}
        onConfirm={() => actions.wakeMutation.mutate(target)}
        title="Wake Process Now"
        description={`Schedule "${label}" to wake immediately. The process decides for itself what a wake at this moment means; the worst case is a wake that does nothing.`}
        isLoading={actions.wakeMutation.isPending}
      />
      <ConfirmDialog
        open={actions.confirmAction === "redrive"}
        onClose={() => actions.setConfirmAction(null)}
        onConfirm={() => actions.redriveInstanceMutation.mutate(target)}
        title="Redrive Dead Messages"
        description={`Return every dead outbox message of "${label}" to pending, due now, with a fresh attempt budget. Deliveries may reach customers; duplicates are absorbed by each message's key.`}
        isLoading={actions.redriveInstanceMutation.isPending}
      />
      {/* Discard asks, because nothing un-discards: no redrive path selects a
          discarded row, so a mis-click is permanent. */}
      <ConfirmDialog
        open={!!actions.discardTarget}
        onClose={() => actions.setDiscardTarget(null)}
        onConfirm={() => {
          if (actions.discardTarget) {
            actions.discardMessageMutation.mutate({
              ...target,
              messageId: actions.discardTarget.id,
            });
          }
        }}
        title="Discard Dead Message"
        description={`Mark "${actions.discardTarget?.intentType}" on "${label}" as never to be sent. The row is kept as the audit record, and it cannot be redriven afterwards.`}
        isLoading={actions.discardMessageMutation.isPending}
      />
    </>
  );
}

/** URL-routed drawer for one process instance (dev/docs/best_practices/drawers.md). */
export function ProcessInstanceDrawer({
  processName = "",
  projectId = "",
  processKey = "",
}: Props) {
  const { closeDrawer } = useDrawer();
  const { hasAccess } = useOpsPermission();
  const { colorMode } = useColorMode();
  const shikiAdapter = useShikiAdapter(colorMode);

  const target = { processName, projectId, processKey };
  const enabled = !!processName && !!projectId && !!processKey;
  const [outboxPage, setOutboxPage] = useState(1);

  const detailQuery = api.ops.getProcessInstance.useQuery(target, { enabled });
  const outboxQuery = api.ops.listProcessOutbox.useQuery(
    { ...target, page: outboxPage, pageSize: OUTBOX_PAGE_SIZE },
    { enabled },
  );
  const grafanaQuery = api.ops.getGrafanaLinkConfig.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });

  const actions = useProcessInstanceActions();
  const detail = detailQuery.data ?? null;

  const copyKey = () => {
    navigator.clipboard.writeText(processKey).then(
      () => toaster.create({ title: "Process key copied", type: "success" }),
      () => toaster.create({ title: "Couldn't copy the key", type: "error" }),
    );
  };

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="lg"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <InstanceDrawerTitle
            label={`${processName} / ${processKey}`}
            onCopyKey={copyKey}
          />
        </Drawer.Header>
        <Drawer.Body>
          <CodeBlock.AdapterProvider value={shikiAdapter}>
            <ProcessInstanceContent
              detail={detail}
              isLoading={detailQuery.isPending}
              outbox={outboxQuery.data ?? null}
              outboxLoading={outboxQuery.isPending}
              outboxPage={outboxPage}
              outboxPageSize={OUTBOX_PAGE_SIZE}
              onOutboxPageChange={setOutboxPage}
              grafana={grafanaQuery.data ?? null}
              canManage={hasAccess}
              onRedriveMessage={(messageId) =>
                actions.redriveMessageMutation.mutate({ ...target, messageId })
              }
              onDiscardMessage={actions.setDiscardTarget}
              onReleaseLease={(messageId) =>
                actions.releaseLeaseMutation.mutate({ ...target, messageId })
              }
              actionPending={
                actions.redriveMessageMutation.isPending ||
                actions.discardMessageMutation.isPending ||
                actions.releaseLeaseMutation.isPending
              }
              now={detailQuery.dataUpdatedAt || undefined}
            />
          </CodeBlock.AdapterProvider>
        </Drawer.Body>
        {hasAccess && detail && (
          <Drawer.Footer>
            <InstanceDrawerActions actions={actions} />
          </Drawer.Footer>
        )}
        <Drawer.CloseTrigger />
      </Drawer.Content>

      <InstanceActionConfirms
        target={target}
        label={`${processName} / ${processKey}`}
        actions={actions}
      />
    </Drawer.Root>
  );
}
