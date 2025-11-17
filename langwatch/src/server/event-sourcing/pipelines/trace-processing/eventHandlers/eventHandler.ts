import type { EventHandler as BaseEventHandler } from "../../../library";
import type { SpanEvent, TraceProjection } from "../types";

export type EventHandler = BaseEventHandler<string, SpanEvent, TraceProjection>;
