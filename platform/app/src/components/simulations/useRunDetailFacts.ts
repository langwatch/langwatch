/**
 * What the run detail drawer reads off one run: its title, its ids, the
 * criteria it scored, the parameters it resolved, and whether it produced a
 * conversation at all.
 */

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { runParameterValuesSchema } from "@langwatch/scenario-contract";
import { buildDisplayTitle } from "@langwatch/suite-web";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { shouldShowNoResponse } from "@langwatch/scenario-web";
import type { ScenarioRunState } from "./useRunStateStream";

/**
 * The names of the secrets the run used, as recorded on it.
 *
 * Read defensively, like the plain values beside them: a run recorded by an
 * older build has nothing here, and the section is simply shorter.
 */
const secretParameterNamesSchema = z.array(z.string());

type RunStateInput = ScenarioRunState | undefined;

/** The case name, and the target it ran against when the map knows it. */
function useRunDisplayTitle(scenarioState: RunStateInput) {
  const targetNameMap = useTargetNameMap();

  return useMemo(() => {
    const targetRefId = scenarioState?.metadata?.langwatch?.targetReferenceId;
    const targetName = targetRefId ? (targetNameMap.get(targetRefId) ?? null) : null;
    return buildDisplayTitle({
      scenarioName: scenarioState?.name ?? "",
      targetName,
      iteration: undefined,
    });
  }, [scenarioState?.name, scenarioState?.metadata, targetNameMap]);
}

/** Relative time that auto-updates every 30s while the drawer is open. */
function useRunTimeAgo({ isOpen, timestamp }: { isOpen: boolean; timestamp: number | undefined }) {
  const [timeAgo, setTimeAgo] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isOpen || !timestamp) {
      setTimeAgo(undefined);
      return;
    }
    const update = () => setTimeAgo(formatTimeAgo(timestamp));
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [isOpen, timestamp]);

  return timeAgo;
}

/** The ids a reader can copy off the run, once the run has them all. */
function useRunCopyableIds({
  scenarioState,
  scenarioRunId,
}: {
  scenarioState: RunStateInput;
  scenarioRunId: string | undefined;
}) {
  const scenarioId = scenarioState?.scenarioId;
  const batchRunId = scenarioState?.batchRunId;
  const suiteId = scenarioState?.metadata?.langwatch?.simulationSuiteId;

  return useMemo(() => {
    if (!scenarioId || !batchRunId || !scenarioRunId) return undefined;
    return [
      { label: "Scenario", value: scenarioId },
      { label: "Batch", value: batchRunId },
      { label: "Run", value: scenarioRunId },
      ...(suiteId ? [{ label: "Run plan", value: suiteId }] : []),
    ];
  }, [scenarioId, batchRunId, scenarioRunId, suiteId]);
}

/**
 * The values this run resolved, as recorded when it was queued, and the names
 * of the credentials it needed. A run from before parameters existed, or one
 * whose scenarios declare none, has nothing here and shows no section at all.
 */
function useRunParameters(scenarioState: RunStateInput) {
  const metadata = scenarioState?.metadata;

  const parameters = useMemo(() => {
    const parsed = runParameterValuesSchema.safeParse(metadata?.parameters);
    if (!parsed.success) return [];
    return Object.entries(parsed.data);
  }, [metadata]);

  // The values are not recorded, so the section shows the names and a mask in
  // place of a value.
  const secretParameterNames = useMemo(() => {
    const parsed = secretParameterNamesSchema.safeParse(metadata?.secretParameterNames);
    return parsed.success ? parsed.data : [];
  }, [metadata]);

  return { parameters, secretParameterNames };
}

/** The first trace of the run, which the thread and trace links open on. */
function useFirstTraceId(scenarioState: RunStateInput) {
  return useMemo(() => {
    const messages = scenarioState?.messages ?? [];
    for (const msg of messages) {
      if (msg.trace_id) return msg.trace_id;
    }
    return undefined;
  }, [scenarioState?.messages]);
}

/**
 * A finished run that produced no messages (and didn't fail at the infra
 * level) means the agent under test returned nothing, so the drawer shows an explicit
 * "No response" state instead of silently omitting the conversation.
 */
function readConversation({
  scenarioState,
  streamingMessages,
}: {
  scenarioState: RunStateInput;
  streamingMessages: unknown[] | undefined;
}) {
  const storedCount = (scenarioState?.messages ?? []).length;
  const streamingCount = (streamingMessages ?? []).length;
  const hasConversation = storedCount + streamingCount > 0;

  return {
    hasConversation,
    conversationCount: storedCount + streamingCount,
    shouldShowNoResponse: shouldShowNoResponse({
      status: scenarioState?.status,
      hasConversation,
      hasError: Boolean(scenarioState?.results?.error),
    }),
  };
}

/** The criteria the judge met, out of the ones it scored. */
function useRunCriteria(scenarioState: RunStateInput) {
  const results = scenarioState?.results;

  return useMemo(() => {
    if (!results) return null;
    const met = results.metCriteria?.length ?? 0;
    const unmet = results.unmetCriteria?.length ?? 0;
    return { met, total: met + unmet };
  }, [results]);
}

export function useRunDetailFacts({
  scenarioState,
  streamingMessages,
  scenarioRunId,
  isOpen,
}: {
  scenarioState: RunStateInput;
  streamingMessages: unknown[] | undefined;
  scenarioRunId: string | undefined;
  isOpen: boolean;
}) {
  return {
    displayTitle: useRunDisplayTitle(scenarioState),
    firstTraceId: useFirstTraceId(scenarioState),
    timeAgo: useRunTimeAgo({ isOpen, timestamp: scenarioState?.timestamp }),
    copyableIds: useRunCopyableIds({ scenarioState, scenarioRunId }),
    criteria: useRunCriteria(scenarioState),
    ...useRunParameters(scenarioState),
    ...readConversation({ scenarioState, streamingMessages }),
  };
}
