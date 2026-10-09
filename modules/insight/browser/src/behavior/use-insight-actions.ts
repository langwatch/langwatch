/**
 * The reader's acts on an insight. Each writes optimistically into the cached inbox, since the
 * worker folds the event a moment later; the read hint then brings the folded row back.
 */

import type { FileInsightInput, InsightEntry } from "@langwatch/insight-contract";
import { nowInstant } from "@langwatch/time";
import { useEffect } from "react";

import { useInsightHost } from "../model/insight-host.ts";
import { insightApi } from "./insight-api.ts";

type Patch = (entry: InsightEntry, now: number) => InsightEntry;

export function useInsightActions({ projectId }: { projectId: string }) {
  const host = useInsightHost();
  const utils = insightApi.useUtils();

  const patch = ({ insightIds, apply }: { insightIds: readonly string[]; apply: Patch }) => {
    const ids = new Set(insightIds);
    const now = nowInstant().epochMilliseconds;
    utils.insights.getAll.setData({ projectId }, (entries: InsightEntry[] | undefined) =>
      entries?.map((entry) => (ids.has(entry.id) ? apply(entry, now) : entry)),
    );
  };
  const reload = () => void utils.insights.getAll.invalidate({ projectId });

  const archive = insightApi.insights.archive.useMutation();
  const keep = insightApi.insights.keep.useMutation();

  return {
    markDone(insightId: string) {
      patch({ insightIds: [insightId], apply: (entry, now) => ({ ...entry, archivedAt: now }) });
      archive.mutate(
        { projectId, insightId },
        {
          onSuccess: () => host.succeeded({ title: "Done. Moved to Archived." }),
          onError: (error) => {
            reload();
            host.failed({ error, fallbackTitle: "Couldn't mark this insight done" });
          },
        },
      );
    },
    keep(insightId: string) {
      patch({
        insightIds: [insightId],
        apply: (entry, now) => ({ ...entry, keptAt: now, archivedAt: null }),
      });
      keep.mutate(
        { projectId, insightId },
        {
          onSuccess: () => host.succeeded({ title: "Kept. Back in the inbox." }),
          onError: (error) => {
            reload();
            host.failed({ error, fallbackTitle: "Couldn't keep this insight" });
          },
        },
      );
    },
  };
}

/**
 * A folder visit marks what it shows as seen, once per set of unseen ids. The cache is patched
 * first, so the next render finds nothing unseen and the effect settles.
 */
export function useMarkShownSeen({
  projectId,
  insightIds,
}: {
  projectId: string;
  insightIds: readonly string[];
}) {
  const utils = insightApi.useUtils();
  const { mutate } = insightApi.insights.markSeen.useMutation({
    onError: () => void utils.insights.getAll.invalidate({ projectId }),
  });
  const key = insightIds.join(",");

  useEffect(() => {
    if (!key) return;
    const ids = new Set(key.split(","));
    const now = nowInstant().epochMilliseconds;
    utils.insights.getAll.setData({ projectId }, (entries: InsightEntry[] | undefined) =>
      entries?.map((entry) =>
        ids.has(entry.id) ? { ...entry, seenAt: entry.seenAt ?? now } : entry,
      ),
    );
    mutate({ projectId, insightIds: [...ids] });
  }, [key, projectId, mutate, utils]);
}

/** Filing from a Langy answer: the new entry goes to the top of the cached inbox. */
export function useFileInsight({ projectId }: { projectId: string }) {
  const utils = insightApi.useUtils();
  const file = insightApi.insights.file.useMutation({
    onSuccess: (entry) =>
      utils.insights.getAll.setData({ projectId }, (entries: InsightEntry[] | undefined) =>
        entries ? [entry, ...entries.filter((existing) => existing.id !== entry.id)] : entries,
      ),
  });
  return {
    file: (
      input: Omit<FileInsightInput, "projectId">,
      options: { onSuccess: () => void; onError: (error: unknown) => void },
    ) => file.mutate({ ...input, projectId }, options),
    isPending: file.isPending,
  };
}
