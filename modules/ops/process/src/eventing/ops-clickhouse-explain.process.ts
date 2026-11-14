import type { EventHandler, IntentSpec } from "@langwatch/eventing";
import { z } from "zod";

import type {
  ClickHouseExplainRequested,
  clickhouseExplainRequestedDataSchema,
} from "./ops-clickhouse-explain.events.ts";

export const CLICKHOUSE_EXPLAIN_PROCESS_NAME = "clickhouseExplain";

export const clickhouseExplainStateSchema = z.object({ requestedAt: z.number().nullable() });
type ClickHouseExplainState = z.infer<typeof clickhouseExplainStateSchema>;

export const CLICKHOUSE_EXPLAIN_INITIAL_STATE: ClickHouseExplainState = { requestedAt: null };

type ClickHouseExplainIntents = {
  explain: IntentSpec<typeof clickhouseExplainRequestedDataSchema>;
};

/** Keyed by the request, so a redelivered request asks for its EXPLAIN once. */
export const onClickHouseExplainRequested: EventHandler<
  ClickHouseExplainState,
  ClickHouseExplainRequested,
  ClickHouseExplainIntents
> = (_state, request, ctx) => ({
  state: { requestedAt: ctx.at },
  intents: [ctx.intent("explain", `explain:${request.requestId}`, request)],
});
