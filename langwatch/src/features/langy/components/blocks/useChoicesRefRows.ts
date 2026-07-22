/**
 * Hydrate a choices card's entity refs AS THE VIEWER (ADR-060 §6), through
 * the same hydrator registry every capability card resolves references with
 * (`CAPABILITY_HYDRATORS`) — so an option row always shows what the viewer
 * is allowed to see today, never what the model asserted.
 *
 * Verdicts per option:
 *   - `live`     the hydrator returned the entity — render its current name
 *                and vital line.
 *   - `dead`     a hydrator exists for the ref type and did NOT return the
 *                entity — the thing is gone (or invisible to this viewer);
 *                the option renders disabled.
 *   - `plain`    no ref, or a ref type this registry cannot resolve — the
 *                option renders from its own label, selectable as given.
 *   - `pending`  the fetch is still in flight.
 */
import { useEffect, useMemo, useState } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { LangyChoicesBlock } from "@langwatch/langy";
import { CAPABILITY_HYDRATORS } from "../capabilities/capabilityHydrators";

export type ChoicesRefRow =
  | { state: "pending" }
  | { state: "plain" }
  | { state: "dead" }
  | { state: "live"; primary?: string; secondary?: string };

export function useChoicesRefRows(
  options: LangyChoicesBlock["options"],
): ReadonlyMap<string, ChoicesRefRow> {
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();
  const projectId = project?.id ?? null;

  // Group hydratable refs by type so each type resolves in one byIds call.
  const hydratable = useMemo(() => {
    const byType = new Map<string, { optionId: string; refId: string }[]>();
    for (const option of options) {
      if (!option.ref) continue;
      if (!CAPABILITY_HYDRATORS[option.ref.type]?.byIds) continue;
      const list = byType.get(option.ref.type) ?? [];
      list.push({ optionId: option.id, refId: option.ref.id });
      byType.set(option.ref.type, list);
    }
    return byType;
  }, [options]);

  const [resolved, setResolved] = useState<Map<string, ChoicesRefRow>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!projectId || hydratable.size === 0) return;
    let cancelled = false;

    void (async () => {
      const next = new Map<string, ChoicesRefRow>();
      await Promise.all(
        [...hydratable.entries()].map(async ([type, entries]) => {
          const hydrator = CAPABILITY_HYDRATORS[type]?.byIds;
          if (!hydrator) return;
          try {
            const hydration = await hydrator({
              utils,
              projectId,
              ids: entries.map((entry) => entry.refId),
            });
            const rowById = new Map(
              hydration.rows.map((row) => [row.id, row]),
            );
            for (const entry of entries) {
              const row = rowById.get(entry.refId);
              next.set(
                entry.optionId,
                row
                  ? {
                      state: "live",
                      ...(row.primary !== undefined
                        ? { primary: row.primary }
                        : {}),
                      ...(row.secondary !== undefined
                        ? { secondary: row.secondary }
                        : {}),
                    }
                  : { state: "dead" },
              );
            }
          } catch {
            // Couldn't resolve right now: keep the options selectable as
            // given rather than disabling on a transient failure.
            for (const entry of entries) {
              next.set(entry.optionId, { state: "plain" });
            }
          }
        }),
      );
      if (!cancelled) setResolved(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, hydratable, utils]);

  return useMemo(() => {
    const rows = new Map<string, ChoicesRefRow>();
    for (const option of options) {
      if (!option.ref || !CAPABILITY_HYDRATORS[option.ref.type]?.byIds) {
        rows.set(option.id, { state: "plain" });
        continue;
      }
      rows.set(
        option.id,
        resolved.get(option.id) ??
          (projectId ? { state: "pending" } : { state: "plain" }),
      );
    }
    return rows;
  }, [options, resolved, projectId]);
}
