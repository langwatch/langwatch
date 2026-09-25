/**
 * The bar under the queue walk: where this item sits, the step either side,
 * the dataset hand-off switch, and the one way forward. Everything that acts
 * on the item waits while the step in hand is the one the reviewer has left.
 */

import { Box, Button, HStack, Spacer, Spinner, Text } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { RouterOutputs } from "../../behavior/annotation-api.ts";
import { TraceEditButton } from "../../behavior/lent-trace.tsx";
import { useAnnotationHost } from "../../model/annotation-host.ts";
import {
  datasetToggleLabel,
  partitionHint,
  queueItemHref,
} from "../../model/annotation-queue-walk.ts";

export type WalkedQueueItem = NonNullable<RouterOutputs["annotation"]["getQueueWalkStep"]["item"]>;

/** How long the queue bar waits after a route change before it reads settled. */
export const ROUTE_SETTLE_MS = 100;

export function AnnotationQueueBar({
  currentQueueItem,
  position,
  total,
  previousItemId,
  nextItemId,
  isTraceAvailable,
  isFinishing,
  stepIsStale,
  sessionCount,
  handoffWanted,
  onHandoffWantedChange,
  onFinishItem,
  onFinishQueue,
}: {
  currentQueueItem: WalkedQueueItem;
  /** Which one of how many this is; the bar never lists the queue. */
  position: number;
  total: number;
  previousItemId: string | null;
  nextItemId: string | null;
  /** Without a trace the bar keeps navigation and drops everything that acts on it. */
  isTraceAvailable: boolean;
  isFinishing: boolean;
  /** The item above is the one the reviewer has left; the one asked for is in flight. */
  stepIsStale: boolean;
  sessionCount: number;
  handoffWanted: boolean;
  onHandoffWantedChange: (wanted: boolean) => void;
  /** Records this item as done, then carries the reviewer onwards. */
  onFinishItem: (onFinished: () => void) => void;
  /** Ends the walk: the hand-off to a dataset, or the celebration. */
  onFinishQueue: () => void;
}) {
  const host = useAnnotationHost();
  const projectSlug = host.project()?.slug;
  const canEditTrace = host.hasPermission("annotations:update");
  const [isNavigating, setIsNavigating] = useState(false);

  // Released a beat after the route resolves; held so leaving mid-beat sets no state.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );
  const releaseNavigatingWhenSettled = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      setIsNavigating(false);
    }, ROUTE_SETTLE_MS);
  }, []);

  const navigateToQueue = (queueItemId: string) => {
    setIsNavigating(true);
    host.navigate(queueItemHref({ projectSlug, queueItemId }));
    releaseNavigatingWhenSettled();
  };

  const finishAndMoveOn = () => {
    if (!nextItemId) {
      onFinishQueue();
      return;
    }
    onFinishItem(() => navigateToQueue(nextItemId));
  };

  return (
    <Box
      shadow="md"
      padding={5}
      // The Langy launcher is fixed to the bottom-right corner; Done stays clear of it.
      paddingRight="86px"
      width="full"
      position="relative"
    >
      {(isNavigating || stepIsStale) && (
        <Box
          position="absolute"
          inset={0}
          backgroundColor="bg.panel/80"
          zIndex={20}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Spinner />
        </Box>
      )}
      <HStack gap={4} width="full">
        <Button
          variant="outline"
          disabled={!previousItemId || isNavigating || stepIsStale}
          onClick={() => {
            if (previousItemId) navigateToQueue(previousItemId);
          }}
        >
          <ChevronLeft /> Previous
        </Button>
        <Text whiteSpace="nowrap">
          {position} of {total}
        </Text>
        <Spacer />
        {isTraceAvailable ? (
          <>
            <Checkbox
              checked={handoffWanted}
              disabled={sessionCount === 0}
              onCheckedChange={(event) => onHandoffWantedChange(!!event.checked)}
            >
              {datasetToggleLabel(sessionCount)}
            </Checkbox>
            {canEditTrace && (
              <TraceEditButton
                traceId={currentQueueItem.trace?.trace_id ?? currentQueueItem.traceId}
                occurredAtMs={partitionHint(currentQueueItem.trace?.timestamps.started_at)}
                disabled={isNavigating || stepIsStale}
              />
            )}
            <Button
              colorPalette="blue"
              disabled={
                currentQueueItem.doneAt !== null || isFinishing || isNavigating || stepIsStale
              }
              onClick={finishAndMoveOn}
            >
              {nextItemId ? (
                <>
                  Next <ChevronRight />
                </>
              ) : (
                <>
                  <Check /> Done
                </>
              )}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={!nextItemId || isNavigating || stepIsStale}
            onClick={() => {
              if (stepIsStale || !nextItemId) return;
              navigateToQueue(nextItemId);
            }}
          >
            Next <ChevronRight />
          </Button>
        )}
      </HStack>
    </Box>
  );
}
