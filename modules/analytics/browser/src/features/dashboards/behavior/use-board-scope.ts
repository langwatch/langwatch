/**
 * A change of a board's scope, from the header's control or the sidebar's menu: made at once
 * with an Undo, or held for a confirmation when the rules say somebody loses the board.
 * Failures travel raw to the host (#5984).
 * @see modules/dashboard/specs/dashboards-v2.feature AC179, AC180
 */

import {
  dashboardScopeChangeAsksFirst,
  dashboardScopeLoss,
  type DashboardScope,
} from "@langwatch/dashboard-contract";
import { useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  scopeChangedNote,
  type ScopeConfirmWords,
  scopeConfirmWords,
  type ScopedBoard,
  type ScopeNames,
} from "../model/board-scope.ts";
import { offerUndo } from "./widget-undo.ts";

/** A scope a member picked for a board, and the names it is spoken with. */
export type ScopeRequest = { board: ScopedBoard; names: ScopeNames; to: DashboardScope };

const FAILED = "Couldn't change who sees the dashboard";

/** The two calls a change of scope makes; each reports its own failure and answers `undefined`. */
function useScopeCalls() {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();
  const setScope = analyticsApi.dashboards.setScope.useMutation();

  const reported = async <Answer>(call: () => Promise<Answer>): Promise<Answer | undefined> => {
    try {
      return await call();
    } catch (error) {
      host.failed({ error, fallbackTitle: FAILED });
      return void 0;
    }
  };

  /** Whether the scope was written; the lists are read again either way. */
  const write = async ({ board, to }: { board: ScopedBoard; to: DashboardScope }) => {
    const written = await reported(() =>
      setScope.mutateAsync({ projectId, dashboardId: board.id, scope: to }),
    );
    await Promise.all([
      utils.dashboards.getAll.invalidate({ projectId }),
      utils.dashboards.listStarred.invalidate({ projectId }),
    ]);
    return written !== void 0;
  };

  /** How many other members starred the board. */
  const readOtherStars = async (board: ScopedBoard) => {
    const impact = await reported(() =>
      utils.client.dashboards.scopeImpact.query({ projectId, dashboardId: board.id }),
    );
    return impact?.otherStars;
  };

  return { write, readOtherStars, isChanging: setScope.isPending };
}

export function useBoardScope() {
  const { write, readOtherStars, isChanging } = useScopeCalls();
  const [asked, setAsked] = useState<ScopeRequest & { words: ScopeConfirmWords }>();

  const apply = async ({ board, names, to }: ScopeRequest) => {
    const from = board.scope;
    if (!(await write({ board, to }))) return;
    offerUndo({
      title: scopeChangedNote({ board: board.name, to, names }),
      undo: () => void write({ board, to: from }),
    });
  };

  const request = async (ask: ScopeRequest) => {
    const { board, names, to } = ask;
    const from = board.scope;
    if (from === to) return;

    // Only a narrower scope can cost anyone the board, so only then is the count read.
    const loss = dashboardScopeLoss({ from, to });
    const otherStars = loss.teammates || loss.otherProjects ? await readOtherStars(board) : 0;
    if (otherStars === void 0) return;
    if (!dashboardScopeChangeAsksFirst({ from, to, otherStars })) return apply(ask);

    const words = scopeConfirmWords({ board: board.name, from, to, names, otherStars });
    setAsked({ ...ask, words });
  };

  return {
    /** The confirmation waiting for an answer, if any. */
    asking: asked?.words,
    isChanging,
    request: (ask: ScopeRequest) => void request(ask),
    confirm: () => {
      const ask = asked;
      setAsked(void 0);
      if (ask) void apply(ask);
    },
    cancel: () => setAsked(void 0),
  };
}
