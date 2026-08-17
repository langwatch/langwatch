import {
  Button,
  Center,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import {
  DeadLetterSummary,
  DeadLettersEmpty,
  DeadLettersTable,
} from "./DeadLettersCard";
import { useDeadLetterActions } from "./useDeadLetterActions";

const PAGE_SIZE = 25;

/**
 * What an operator types to discard every process's dead letters. The API
 * requires the same phrase, so neither a mis-click nor a script that omits
 * `processName` can reach that breadth.
 */
const FLEET_DISCARD_PHRASE = "DISCARD ALL";

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
  const actions = useDeadLetterActions();

  const query = api.ops.listDeadLetters.useQuery(
    { processName, page, pageSize: PAGE_SIZE },
    { refetchInterval: 30_000 },
  );

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

  // The bulk actions act on exactly what the filter shows: one process, or
  // the whole fleet when no chip is selected. The count in the button IS the
  // blast radius, restated in the confirmation.
  const shownCount = processName
    ? (byProcess.find((row) => row.processName === processName)?.count ?? 0)
    : fleetTotal;

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
        <BulkActionBar
          shownCount={shownCount}
          onRedriveAll={() => actions.setConfirmBulk("redrive")}
          onDiscardAll={() => actions.setConfirmBulk("discard")}
        />
      )}
      <DeadLettersTable
        messages={messages}
        now={now}
        canManage={hasAccess}
        expandedId={expandedId}
        redrivingId={actions.redrivingId}
        discardingId={actions.discardingId}
        onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
        onRedrive={actions.onRedrive}
        onDiscard={actions.onDiscard}
      />
      <Pager
        page={page}
        total={total}
        shown={messages.length}
        onPage={setPage}
      />
      <BulkConfirms
        actions={actions}
        shownCount={shownCount}
        shownScope={processName ?? "every process"}
        processName={processName}
      />
    </VStack>
  );
}

/** Redrive or discard everything the current filter shows. */
function BulkActionBar({
  shownCount,
  onRedriveAll,
  onDiscardAll,
}: {
  shownCount: number;
  onRedriveAll: () => void;
  onDiscardAll: () => void;
}) {
  return (
    <HStack gap={2}>
      <Spacer />
      <Button
        size="xs"
        variant="outline"
        data-testid="dead-redrive-shown"
        onClick={onRedriveAll}
      >
        <RotateCcw size={12} />
        Redrive shown ({shownCount})
      </Button>
      <Button
        size="xs"
        variant="outline"
        colorPalette="red"
        data-testid="dead-discard-shown"
        onClick={onDiscardAll}
      >
        <XCircle size={12} />
        Discard shown ({shownCount})
      </Button>
    </HStack>
  );
}

/**
 * Both bulk confirmations, each naming its blast radius in the operator's own
 * terms (best_practices/ops-dashboard.md).
 */
function BulkConfirms({
  actions,
  shownCount,
  shownScope,
  processName,
}: {
  actions: ReturnType<typeof useDeadLetterActions>;
  shownCount: number;
  shownScope: string;
  processName: string | undefined;
}) {
  const plural = shownCount === 1 ? "message" : "messages";
  // The fleet-wide discard crosses every tenant and cannot be undone, so the
  // operator types the phrase rather than clicking once. The API asks for the
  // same phrase, which stops a script reaching this breadth by omitting a
  // field; this is what makes the ask a human one too.
  const [typed, setTyped] = useState("");
  const fleetWide = processName === undefined;
  const phraseOk = !fleetWide || typed.trim() === FLEET_DISCARD_PHRASE;
  return (
    <>
      {/* Discard asks even for one row, because nothing un-discards it: no
          redrive path selects a discarded message. */}
      <ConfirmDialog
        open={!!actions.discardTarget}
        onClose={() => actions.setDiscardTarget(null)}
        onConfirm={actions.confirmDiscard}
        title="Discard dead letter"
        description={`Mark "${actions.discardTarget?.intentType}" on ${actions.discardTarget?.processName} as never to be sent. The row is kept as the audit record, and it cannot be redriven afterwards.`}
        isLoading={actions.discardingId !== null}
      />
      <ConfirmDialog
        open={actions.confirmBulk === "redrive"}
        onClose={() => actions.setConfirmBulk(null)}
        onConfirm={() => actions.redriveAll.mutate({ processName })}
        title="Redrive dead letters"
        description={`Return all ${shownCount} dead ${plural} for ${shownScope} to pending with a fresh attempt budget. Their deliveries will run again.`}
        isLoading={actions.redriveAll.isPending}
      />
      <ConfirmDialog
        open={actions.confirmBulk === "discard"}
        onClose={() => {
          setTyped("");
          actions.setConfirmBulk(null);
        }}
        onConfirm={() =>
          actions.discardAll.mutate(
            processName ? { processName } : { confirm: FLEET_DISCARD_PHRASE },
          )
        }
        title="Discard dead letters"
        description={`Mark all ${shownCount} dead ${plural} for ${shownScope} as never to be sent. The rows are kept as the audit record, the work will not run, and none of it can be redriven afterwards.`}
        isLoading={actions.discardAll.isPending}
        confirmDisabled={!phraseOk}
      >
        {fleetWide && (
          <Input
            marginTop={3}
            size="sm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={FLEET_DISCARD_PHRASE}
            aria-label={`Type ${FLEET_DISCARD_PHRASE} to confirm`}
            data-testid="dead-discard-all-phrase"
          />
        )}
      </ConfirmDialog>
    </>
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
