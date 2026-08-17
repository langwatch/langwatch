import {
  Button,
  Center,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import {
  type DeadLetterMessage,
  DeadLetterSummary,
  DeadLettersEmpty,
  DeadLettersTable,
} from "./DeadLettersCard";

const PAGE_SIZE = 25;

/**
 * Every message the substrate has permanently given up on.
 *
 * A dead message is work that will never happen again without an operator, so
 * it is the most urgent thing these pages report — and until this view it was
 * only ever a number. `getProcessOutbox` needs a full process ref, so reaching
 * a dead message meant already knowing which instance held it, and the fleet
 * table showed a count with no way in.
 */
export function DeadLettersContent() {
  const { hasAccess } = useOpsPermission();
  const [processName, setProcessName] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [redrivingId, setRedrivingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<"redrive" | "discard" | null>(
    null,
  );

  const utils = api.useUtils();
  const query = api.ops.listDeadLetters.useQuery(
    { processName, page, pageSize: PAGE_SIZE },
    { refetchInterval: 30_000 },
  );

  const redrive = api.ops.processRedriveDeadMessage.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: data.redriven ? "Message redriven" : "Message is no longer dead",
        type: data.redriven ? "success" : "error",
      });
      setRedrivingId(null);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      setRedrivingId(null);
      showErrorToast({ error, fallbackTitle: "Couldn't redrive the message" });
    },
  });
  const discard = api.ops.processDiscardDeadMessage.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: data.discarded
          ? "Message discarded"
          : "Message is no longer dead",
        type: data.discarded ? "success" : "error",
      });
      setDiscardingId(null);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      setDiscardingId(null);
      showErrorToast({ error, fallbackTitle: "Couldn't discard the message" });
    },
  });
  const redriveAll = api.ops.redriveDeadLetters.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Redrove ${data.redriven} ${
          data.redriven === 1 ? "message" : "messages"
        }`,
        type: "success",
      });
      setConfirmBulk(null);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      setConfirmBulk(null);
      showErrorToast({ error, fallbackTitle: "Couldn't redrive the messages" });
    },
  });
  const discardAll = api.ops.discardDeadLetters.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Discarded ${data.discarded} ${
          data.discarded === 1 ? "message" : "messages"
        }`,
        type: "success",
      });
      setConfirmBulk(null);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      setConfirmBulk(null);
      showErrorToast({
        error,
        fallbackTitle: "Couldn't discard the messages",
      });
    },
  });

  if (query.isPending) {
    return (
      <Center paddingY={20}>
        <Spinner size="lg" />
      </Center>
    );
  }

  const messages = query.data?.messages ?? [];
  const byProcess = query.data?.byProcess ?? [];
  const total = query.data?.total ?? 0;
  const fleetTotal = byProcess.reduce((sum, row) => sum + row.count, 0);
  const now = query.dataUpdatedAt || Date.now();

  if (fleetTotal === 0) return <DeadLettersEmpty />;

  const onRedrive = (message: DeadLetterMessage) => {
    setRedrivingId(message.id);
    redrive.mutate({
      processName: message.processName,
      projectId: message.projectId,
      processKey: message.processKey,
      messageId: message.id,
    });
  };
  const onDiscard = (message: DeadLetterMessage) => {
    setDiscardingId(message.id);
    discard.mutate({
      processName: message.processName,
      projectId: message.projectId,
      processKey: message.processKey,
      messageId: message.id,
    });
  };

  // The bulk actions act on exactly what the filter shows: one process, or
  // the whole fleet when no chip is selected. The count in the button IS the
  // blast radius, restated in the confirmation.
  const shownCount = processName
    ? (byProcess.find((row) => row.processName === processName)?.count ?? 0)
    : fleetTotal;
  const shownScope = processName ?? "every process";

  return (
    <VStack align="stretch" gap={4}>
      <DeadLetterSummary
        byProcess={byProcess}
        selected={processName}
        now={now}
        onSelect={(name) => {
          setProcessName(name);
          setPage(1);
        }}
      />
      {hasAccess && shownCount > 0 && (
        <HStack gap={2}>
          <Spacer />
          <Button
            size="xs"
            variant="outline"
            data-testid="dead-redrive-shown"
            onClick={() => setConfirmBulk("redrive")}
          >
            <RotateCcw size={12} />
            Redrive shown ({shownCount})
          </Button>
          <Button
            size="xs"
            variant="outline"
            colorPalette="red"
            data-testid="dead-discard-shown"
            onClick={() => setConfirmBulk("discard")}
          >
            <XCircle size={12} />
            Discard shown ({shownCount})
          </Button>
        </HStack>
      )}
      <DeadLettersTable
        messages={messages}
        now={now}
        canManage={hasAccess}
        expandedId={expandedId}
        redrivingId={redrivingId}
        discardingId={discardingId}
        onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
        onRedrive={onRedrive}
        onDiscard={onDiscard}
      />
      <Pager
        page={page}
        total={total}
        shown={messages.length}
        onPage={setPage}
      />
      <ConfirmDialog
        open={confirmBulk === "redrive"}
        onClose={() => setConfirmBulk(null)}
        onConfirm={() => redriveAll.mutate({ processName })}
        title="Redrive dead letters"
        description={`Return all ${shownCount} dead ${
          shownCount === 1 ? "message" : "messages"
        } for ${shownScope} to pending with a fresh attempt budget. Their deliveries will run again.`}
        isLoading={redriveAll.isPending}
      />
      <ConfirmDialog
        open={confirmBulk === "discard"}
        onClose={() => setConfirmBulk(null)}
        onConfirm={() => discardAll.mutate({ processName })}
        title="Discard dead letters"
        description={`Mark all ${shownCount} dead ${
          shownCount === 1 ? "message" : "messages"
        } for ${shownScope} as never to be sent. The rows are kept as the audit record; the work will not run.`}
        isLoading={discardAll.isPending}
      />
    </VStack>
  );
}

function Pager({
  page,
  total,
  shown,
  onPage,
}: {
  page: number;
  total: number;
  shown: number;
  onPage: (page: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = start + shown - 1;
  return (
    <HStack justify="space-between">
      <Text textStyle="xs" color="fg.muted">
        {start}–{end} of {total}
      </Text>
      <HStack gap={2}>
        <Button
          size="xs"
          variant="outline"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={end >= total}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </HStack>
    </HStack>
  );
}
