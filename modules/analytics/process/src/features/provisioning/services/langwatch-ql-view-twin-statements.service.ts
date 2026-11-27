/**
 * The parameterised twins provisioned beside a LangWatchQL view: the floored twin (analytics
 * ADR-005) and the trace-ids twin (analytics ADR-006, amendment 2026-11-24).
 * @see specs/lwql/dedup-floor.feature
 * @see specs/lwql/dedup-trace-ids.feature
 */

import { LWQL_FLOOR_PARAMETER } from "../../../rules/lwql-dedup-floor.rules.ts";
import {
  hasTraceIdsTwin,
  LWQL_TRACE_IDS_PARAMETER,
} from "../../../rules/lwql-dedup-trace-ids.rules.ts";
import {
  FLOORED_DEDUP_STRATEGIES,
  type LangWatchQLDedupStrategy,
} from "../../../rules/lwql-view-dedup-shape.rules.ts";
import { type LangWatchQLNames } from "../../../services/langwatch-ql-access-model.service.ts";
import { type LangWatchQLViewDefinition } from "../../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLViewDedupService } from "./langwatch-ql-view-dedup.service.ts";
import { LangWatchQLViewStatementsService } from "./langwatch-ql-view-statements.service.ts";

const viewDedup = LangWatchQLViewDedupService.create();
const viewStatements = LangWatchQLViewStatementsService.create();

/** What a twin is rendered from: the same inputs as the view it is cut from. */
interface TwinInput {
  names: LangWatchQLNames;
  sourceDatabase: string;
  view: LangWatchQLViewDefinition;
  dedup: LangWatchQLDedupStrategy;
}

export class LangWatchQLViewTwinStatementsService {
  static create(): LangWatchQLViewTwinStatementsService {
    return new LangWatchQLViewTwinStatementsService();
  }

  private constructor() {}

  /**
   * `CREATE OR REPLACE VIEW` for a view's floored twin: a parameterised view the executor reads
   * in place of the view when the statement bounds the floor column below. None for a view
   * whose dedup declares no floor column.
   */
  flooredViewStatements({ names, sourceDatabase, view, dedup }: TwinInput): string[] {
    const { floorColumn } = view.dedup;
    const columns = view.columns.filter((column) => column.name === floorColumn);
    if (!FLOORED_DEDUP_STRATEGIES.has(viewDedup.strategyFor({ view, dedup }))) return [];
    // The twin reads its bound from a parameter typed like the floor column.
    return columns.map((column) =>
      viewStatements.viewStatement({
        names,
        sourceDatabase,
        view,
        dedup,
        floor: `{${LWQL_FLOOR_PARAMETER}:${column.type}}`,
      }),
    );
  }

  /**
   * `CREATE OR REPLACE VIEW` for a view's trace-ids twin: a parameterised view a pass reads in
   * place of the view, cut by the traces it holds before `LIMIT 1 BY`. None for a view that is
   * not `latest-in-order` by trace.
   */
  traceIdsViewStatements({ names, sourceDatabase, view, dedup }: TwinInput): string[] {
    if (!hasTraceIdsTwin(view)) return [];
    const traceIds = `{${LWQL_TRACE_IDS_PARAMETER}:Array(String)}`;
    return [viewStatements.viewStatement({ names, sourceDatabase, view, dedup, traceIds })];
  }
}
