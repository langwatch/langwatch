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
import { useEffect, useEffectEvent, useRef } from "react";

import {
  defaultRunSettings,
  type InsightLastRun,
  requestedRunEndWords,
  requestedRunOf,
  runTimeWords,
  TEMPLATE_BOARD_NOTE,
} from "../model/daily-run.ts";
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

/** No run reads a From LangWatch board yet, so its toast says so instead of a promise. */
function turnedOnWords({
  kind,
  settings,
}: {
  kind: InsightRunBoard["kind"];
  settings: InsightRunSettings;
}): string {
  return kind === "template"
    ? TEMPLATE_BOARD_NOTE
    : `Langy reads this board every day ${runTimeWords(settings)}.`;
}

/** Langy's panel opens on `?langyConversation=` wherever a project page is. */
function openInLangy({ host, conversationId }: { host: InsightHostApi; conversationId: string }) {
  host.setQuery({ ...host.query(), [LANGY_CONVERSATION_PARAM]: conversationId });
}

/** What a requested run's arrival says: Langy on its conversation, else how it ended. */
function showRequestedRun({
  host,
  conversationId,
  settled,
}: {
  host: InsightHostApi;
  conversationId: string | null;
  settled: InsightLastRun | null;
}) {
  if (conversationId !== null) {
    openInLangy({ host, conversationId });
  } else if (settled !== null) {
    host.informed({ title: requestedRunEndWords(settled) });
  }
}

/**
 * One deadline, not a poll: past a run's expiry the server holds the run as lost. The spinner ends
 * there at once, and the one read the deadline fires gives the verdict when it answers: a run it
 * shows is opened, none or a failed read says the run could not be started, and a read that never
 * answers says nothing (ADR-004). The verdict has no timer; it dies with the page, a newer
 * request, or `cancelVerdict`.
 */
function useRequestedRunDeadline({
  request,
  isAwaitingRun,
  readOnce,
  onExpired,
  onFound,
  onLost,
}: {
  /** What the server answered Run now with. */
  request: { requestId: string; requestedAt: number } | undefined;
  isAwaitingRun: boolean;
  readOnce: () => Promise<{ data?: InsightDailyRunSetting | undefined }>;
  /** Ends the spinner. */
  onExpired: () => void;
  onFound: (requested: NonNullable<ReturnType<typeof requestedRunOf>>) => void;
  onLost: () => void;
}): { cancelVerdict: () => void } {
  // The host is rebuilt on each change of the URL's query: it reaches the deadline, never moves it.
  const readLastTime = useEffectEvent(readOnce);
  const endWait = useEffectEvent(onExpired);
  const showRun = useEffectEvent(onFound);
  const sayLost = useEffectEvent(onLost);
  /** The request whose verdict is still owed; ending the spinner clears the request, not this. */
  const verdictOwedTo = useRef<object | undefined>(undefined);
  useEffect(() => () => void (verdictOwedTo.current = undefined), []);
  useEffect(() => {
    if (request && verdictOwedTo.current !== request) verdictOwedTo.current = undefined;
    if (!isAwaitingRun || !request) return;
    const deadline = setTimeout(() => {
      verdictOwedTo.current = request;
      endWait();
      void readLastTime().then(({ data }) => {
        if (verdictOwedTo.current !== request) return;
        verdictOwedTo.current = undefined;
        // A failed read hands back what the board last read, which shows no run either.
        const requested = data ? requestedRunOf({ setting: data, ...request }) : undefined;
        if (requested) showRun(requested);
        else sayLost();
      });
    }, INSIGHT_DAILY_RUN_EXPIRY_MS);
    return () => clearTimeout(deadline);
  }, [isAwaitingRun, request]);
  return { cancelVerdict: () => void (verdictOwedTo.current = undefined) };
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
  // The run's start and outcome reach the read as hints; no timer asks (ADR-004).
  const query = insightApi.insights.getBoardDailyRun.useQuery(scope, { enabled: available });
  const utils = insightApi.useUtils();
  const configure = insightApi.insights.configureBoardDailyRun.useMutation();
  const turnOffRun = insightApi.insights.turnOffBoardDailyRun.useMutation();
  const runNowRequest = insightApi.insights.runBoardDailyRunNow.useMutation();
  const { reset: endRunNow } = runNowRequest;

  // The request's id, or a run that started or settled after the request (ADR-004).
  const requested =
    runNowRequest.data && query.data
      ? requestedRunOf({ setting: query.data, ...runNowRequest.data })
      : undefined;
  const hasRequestedRunShown = requested !== undefined;
  const requestedConversationId = requested?.conversationId ?? null;
  const requestedSettledRun = requested?.settled ?? null;
  const isAwaitingRun = runNowRequest.isSuccess && !hasRequestedRunShown;
  useEffect(() => {
    if (!hasRequestedRunShown) return;
    endRunNow();
    showRequestedRun({
      host,
      conversationId: requestedConversationId,
      settled: requestedSettledRun,
    });
  }, [hasRequestedRunShown, requestedConversationId, requestedSettledRun, endRunNow, host]);
  const sayRunNotStarted = () => {
    host.failed({
      error: new Error("The requested run never showed"),
      fallbackTitle: RUN_NOT_STARTED,
    });
  };
  const { cancelVerdict } = useRequestedRunDeadline({
    request: runNowRequest.data,
    isAwaitingRun,
    readOnce: query.refetch,
    onExpired: endRunNow,
    onFound: ({ conversationId, settled = null }) =>
      showRequestedRun({ host, conversationId, settled }),
    onLost: sayRunNotStarted,
  });

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
      done: `${done} ${turnedOnWords({ kind: board.kind, settings })}`,
      fallbackTitle,
    });
  const turnOffWith = ({ done, fallbackTitle }: { done: string; fallbackTitle: string }) => {
    // A board switched off owes no panel and no toast, and turning it on again starts no wait.
    endRunNow();
    cancelVerdict();
    write({
      next: (current) => ({ ...current, state: "off", offReason: null }),
      send: (handlers) => turnOffRun.mutate({ projectId, board }, handlers),
      done,
      fallbackTitle,
    });
  };

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
    /** True from Run now until its run shows, it is turned off, or a run's expiry passes. */
    isStartingRun: runNowRequest.isPending || isAwaitingRun,
    runNow: () =>
      runNowRequest.mutate(
        { projectId, board, maxInsights: settings.maxInsights },
        {
          onError: (error) => host.failed({ error, fallbackTitle: RUN_NOT_STARTED }),
        },
      ),
    openInLangy: (conversationId: string) => openInLangy({ host, conversationId }),
  };
}
