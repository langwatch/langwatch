// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Insight's facts as nurturing signals: who acted, which act, and for a filing only its bounded
 * facts. No title, body, query or insight id travels on. Pure.
 * @see enterprise/modules/nurturing/specs/insight-lifecycle.feature
 */
import type { NurturingSignal, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import type { InsightFiledEventData, InsightReaderEventData } from "@langwatch/insight-contract";

/** The insight event a signal is raised from: one signal per event, keyed by its id. */
type InsightEventContext = Readonly<{ eventId: string; tenantId: string; occurredAt: number }>;

const sourceOf = ({ eventId, tenantId, occurredAt }: InsightEventContext) => ({
  sourceEventId: eventId,
  tenantId,
  occurredAt,
  projectId: tenantId,
});

/** An insight filed, on its owner; none for one stored before owners with no filer either. */
export function insightFiledSignal({
  data,
  context,
}: {
  data: InsightFiledEventData;
  context: InsightEventContext;
}): NurturingSignal[] {
  const userId = data.ownerUserId ?? data.filedByUserId;
  if (!userId) return [];
  return [
    {
      kind: "insight_acted",
      ...sourceOf(context),
      userId,
      act: "filed",
      filedVia: data.filedVia,
      tone: data.tone,
      fromBoard: data.board !== null,
    },
  ];
}

/** The owner's own act on their insight: seen, marked done or kept. */
export function insightReaderSignal({
  act,
  data,
  context,
}: {
  act: "seen" | "archived" | "kept";
  data: InsightReaderEventData;
  context: InsightEventContext;
}): NurturingSignal {
  return { kind: "insight_acted", ...sourceOf(context), userId: data.userId, act };
}

/** The PostHog event an insight act is tracked as: `insights.<act>.insight`, bounded facts only. */
export function insightActedEvent(signal: NurturingSignalOf<"insight_acted">): {
  userId: string;
  event: string;
  properties: Record<string, unknown>;
} {
  const { userId, act, filedVia, tone, fromBoard } = signal;
  const filing = act === "filed" ? { filedVia, tone, fromBoard } : {};
  return { userId, event: `insights.${act}.insight`, properties: filing };
}
