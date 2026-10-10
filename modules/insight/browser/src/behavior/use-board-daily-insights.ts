/**
 * One person's daily run on one board: the read, and the three acts on it. Each write lands
 * in the cached read first, since the worker folds the event a moment later; a refused write
 * puts the read back and says so.
 * @see modules/insight/adrs/004-daily-run.md
 */

import type {
  InsightDailyRunSetting,
  InsightRunBoard,
  InsightRunSettings,
} from "@langwatch/insight-contract";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { currentTimeZone } from "@langwatch/time";

import { defaultRunSettings, runTimeWords } from "../model/daily-run.ts";
import { useInsightHost } from "../model/insight-host.ts";
import { insightApi } from "./insight-api.ts";

const NEVER_DECIDED: InsightDailyRunSetting = { state: "undecided", settings: null, lastRun: null };

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
  const query = insightApi.insights.getBoardDailyRun.useQuery(scope, { enabled: available });
  const utils = insightApi.useUtils();
  const configure = insightApi.insights.configureBoardDailyRun.useMutation();
  const turnOffRun = insightApi.insights.turnOffBoardDailyRun.useMutation();

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
      next: (current) => ({ ...current, state: "on", settings }),
      send: (handlers) => configure.mutate({ projectId, board, ...settings }, handlers),
      done: `${done} Langy reads this board every day ${runTimeWords(settings)}.`,
      fallbackTitle,
    });
  const turnOffWith = ({ done, fallbackTitle }: { done: string; fallbackTitle: string }) =>
    write({
      next: (current) => ({ ...current, state: "off" }),
      send: (handlers) => turnOffRun.mutate({ projectId, board }, handlers),
      done,
      fallbackTitle,
    });

  const ownTimezone = currentTimeZone() || "UTC";
  return {
    /** False without a project that takes runs, the flag or the grant: draw nothing. */
    available,
    /** Undefined until the read answers. */
    setting: available ? query.data : undefined,
    /** What the person last chose, or what a board starts with. */
    settings: query.data?.settings ?? defaultRunSettings({ timezone: ownTimezone }),
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
    /** "No thanks" on the offer: an off, so the board never asks again. */
    decline: () =>
      turnOffWith({
        done: "OK. Langy will not ask again for this board.",
        fallbackTitle: "Couldn't save your answer",
      }),
  };
}
