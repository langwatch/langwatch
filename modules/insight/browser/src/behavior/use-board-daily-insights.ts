/**
 * One person's daily run on one board: the read, the three acts on it, and Run now. Each write
 * lands in the cached read first, since the worker folds the event a moment later; a refused
 * write puts the read back and says so. Run now opens Langy on the run once it started.
 * @see modules/insight/adrs/004-daily-run.md
 */

import {
  INSIGHT_DAILY_RUN_EXPIRY_MS,
  type InsightDailyRunSetting,
  type InsightRunBoard,
  type InsightRunSettings,
} from "@langwatch/insight-contract";
import { LANGY_CONVERSATION_PARAM } from "@langwatch/langy-contract";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { currentTimeZone } from "@langwatch/time";
import { useCallback, useEffect, useRef } from "react";

import { defaultRunSettings, requestedRunOf, runTimeWords } from "../model/daily-run.ts";
import { type InsightHostApi, useInsightHost } from "../model/insight-host.ts";
import { insightApi } from "./insight-api.ts";

const NEVER_DECIDED: InsightDailyRunSetting = {
  state: "undecided",
  settings: null,
  lastRun: null,
  offReason: null,
  runInFlight: null,
};

const RUN_NOT_STARTED = "Couldn't start the run";

/** A hint can reach the tab before the worker stored the row it names; these outlast that gap. */
export const REQUESTED_RUN_REREAD_DELAYS_MS = [2_000, 4_000, 8_000, 16_000] as const;

/** Langy's panel opens on `?langyConversation=` wherever a project page is. */
function openInLangy({ host, conversationId }: { host: InsightHostApi; conversationId: string }) {
  host.setQuery({ ...host.query(), [LANGY_CONVERSATION_PARAM]: conversationId });
}

/**
 * A hint races the row it names (ADR-004): a read it brought back without the awaited run is
 * asked again after each delay in turn, until the run shows. Answers a read for Run now to ask
 * with, which starts no re-reads.
 */
function useRereadWhileAwaiting({
  scope: {
    projectId,
    board: { kind, id },
  },
  answeredAt,
  isAwaitingRun,
}: {
  scope: { projectId: string; board: { kind: InsightRunBoard["kind"]; id: string } };
  /** When the read last answered. */
  answeredAt: number;
  isAwaitingRun: boolean;
}): () => void {
  const utils = insightApi.useUtils();
  const seenAnswer = useRef(answeredAt);
  /** How many re-reads came before the read in flight; null when a hint asked it. */
  const rereadsBefore = useRef<number | null>(null);
  const readAgain = useCallback(
    (rereads: number) => {
      rereadsBefore.current = rereads;
      void utils.insights.getBoardDailyRun.invalidate({ projectId, board: { kind, id } });
    },
    [utils, projectId, kind, id],
  );
  useEffect(() => {
    if (answeredAt === seenAnswer.current) return;
    seenAnswer.current = answeredAt;
    const rereads = rereadsBefore.current ?? 0;
    rereadsBefore.current = null;
    const delay = REQUESTED_RUN_REREAD_DELAYS_MS[rereads];
    if (!isAwaitingRun || delay === undefined) return;
    const reread = setTimeout(() => readAgain(rereads + 1), delay);
    return () => clearTimeout(reread);
  }, [answeredAt, isAwaitingRun, readAgain]);
  return () => readAgain(REQUESTED_RUN_REREAD_DELAYS_MS.length);
}

type Write = {
  next: (current: InsightDailyRunSetting) => InsightDailyRunSetting;
  send: (handlers: { onSuccess: () => void; onError: (error: unknown) => void }) => void;
  done: string;
  fallbackTitle: string;
};

export function useBoardDailyInsights({ board }: { board: InsightRunBoard }) {
  const host = useInsightHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  // An aggregate takes no setting, and its read answers undecided: no control there at all.
  const available =
    project !== undefined &&
    !isAggregateProjectKind(project.kind) &&
    host.isEnabled() === true &&
    host.hasPermission("analytics:view");
  const scope = { projectId, board: { kind: board.kind, id: board.id } };
  // The run's start and outcome reach the read as hints; no timer asks, bar re-reads after one.
  const query = insightApi.insights.getBoardDailyRun.useQuery(scope, { enabled: available });
  const utils = insightApi.useUtils();
  const configure = insightApi.insights.configureBoardDailyRun.useMutation();
  const turnOffRun = insightApi.insights.turnOffBoardDailyRun.useMutation();
  const runNowRequest = insightApi.insights.runBoardDailyRunNow.useMutation();
  const { reset: endRunNow } = runNowRequest;

  // Matched by the request's id: a run settling meanwhile is not the one asked for (ADR-004).
  const requested =
    runNowRequest.data && query.data
      ? requestedRunOf({ setting: query.data, requestId: runNowRequest.data.requestId })
      : undefined;
  const hasRequestedRunShown = requested !== undefined;
  const requestedConversationId = requested?.conversationId ?? null;
  const isAwaitingRun = runNowRequest.isSuccess && !hasRequestedRunShown;
  const readAgain = useRereadWhileAwaiting({
    scope,
    answeredAt: query.dataUpdatedAt,
    isAwaitingRun,
  });
  useEffect(() => {
    if (!hasRequestedRunShown) return;
    endRunNow();
    if (requestedConversationId !== null) {
      openInLangy({ host, conversationId: requestedConversationId });
    }
  }, [hasRequestedRunShown, requestedConversationId, endRunNow, host]);
  // One deadline, not a poll: past a run's expiry the server holds the run as lost, so say so.
  useEffect(() => {
    if (!isAwaitingRun) return;
    const lost = setTimeout(() => {
      endRunNow();
      host.failed({
        error: new Error("The requested run never showed"),
        fallbackTitle: RUN_NOT_STARTED,
      });
    }, INSIGHT_DAILY_RUN_EXPIRY_MS);
    return () => clearTimeout(lost);
  }, [isAwaitingRun, endRunNow, host]);

  const write = ({ next, send, done, fallbackTitle }: Write) => {
    const before = utils.insights.getBoardDailyRun.getData(scope);
    utils.insights.getBoardDailyRun.setData(scope, (current: InsightDailyRunSetting | undefined) =>
      next(current ?? NEVER_DECIDED),
    );
    send({
      onSuccess: () => host.succeeded({ title: done }),
      onError: (error) => {
        utils.insights.getBoardDailyRun.setData(scope, before);
        void utils.insights.getBoardDailyRun.invalidate(scope);
        host.failed({ error, fallbackTitle });
      },
    });
  };

  const configureWith = ({
    settings,
    done,
    fallbackTitle,
  }: {
    settings: InsightRunSettings;
    done: string;
    fallbackTitle: string;
  }) =>
    write({
      next: (current) => ({ ...current, state: "on", settings, offReason: null }),
      send: (handlers) => configure.mutate({ projectId, board, ...settings }, handlers),
      done: `${done} Langy reads this board every day ${runTimeWords(settings)}.`,
      fallbackTitle,
    });
  const turnOffWith = ({ done, fallbackTitle }: { done: string; fallbackTitle: string }) =>
    write({
      next: (current) => ({ ...current, state: "off", offReason: null }),
      send: (handlers) => turnOffRun.mutate({ projectId, board }, handlers),
      done,
      fallbackTitle,
    });

  const ownTimezone = currentTimeZone() || "UTC";
  const settings = query.data?.settings ?? defaultRunSettings({ timezone: ownTimezone });
  return {
    /** False without a project that takes runs, the flag or the grant: draw nothing. */
    available,
    /** Undefined until the read answers. */
    setting: available ? query.data : undefined,
    /** What the person last chose, or what a board starts with. */
    settings,
    ownTimezone,
    insightsHref: project ? `/${project.slug}/insights` : undefined,
    turnOn: (settings: InsightRunSettings) =>
      configureWith({
        settings,
        done: "Daily insights on.",
        fallbackTitle: "Couldn't turn on daily insights",
      }),
    save: (settings: InsightRunSettings) =>
      configureWith({
        settings,
        done: "Saved.",
        fallbackTitle: "Couldn't save the daily insights settings",
      }),
    turnOff: () =>
      turnOffWith({
        done: "Daily insights off. What Langy filed stays in your inbox.",
        fallbackTitle: "Couldn't turn off daily insights",
      }),
    /** A run is a Langy turn, so Run now asks what turning the run on asks. */
    mayRunNow: host.hasPermission("langy:create"),
    /** True from Run now until its run shows, or a run's expiry passes without it. */
    isStartingRun: runNowRequest.isPending || isAwaitingRun,
    runNow: () =>
      runNowRequest.mutate(
        { projectId, board, maxInsights: settings.maxInsights },
        {
          onSuccess: readAgain,
          onError: (error) => host.failed({ error, fallbackTitle: RUN_NOT_STARTED }),
        },
      ),
    openInLangy: (conversationId: string) => openInLangy({ host, conversationId }),
    /** "No thanks" on the offer: an off, so the board never asks again. */
    decline: () =>
      turnOffWith({
        done: "OK. Langy will not ask again for this board.",
        fallbackTitle: "Couldn't save your answer",
      }),
  };
}
