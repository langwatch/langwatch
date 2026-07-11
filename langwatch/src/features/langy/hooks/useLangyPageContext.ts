import { useMemo } from "react";
import { useInRouterContext, useLocation } from "react-router";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useLangy } from "../LangyContext";
import {
  type LangyContextChip,
  selectDismissedChips,
  selectVisibleChips,
  useLangyStore,
} from "../stores/langyStore";

/**
 * Captures what the user is currently viewing and turns it into composer
 * context chips (task #14).
 *
 * Sources, most-specific first:
 *   1. The route the user is on — `/messages/<trace>`, `/experiments/<slug>`,
 *      `/datasets/<id>` — parsed from the URL. No page edits needed.
 *   2. The experiment the workbench registered via `useRegisterLangyHandlers`.
 *   3. Any precise context a page declared via `useRegisterLangyPageContext`
 *      (a selected prompt / dashboard the URL can't express).
 *   4. The project itself — the scope Langy always operates in.
 *
 * Returns the visible chips (undismissed) plus the dismissed candidates that
 * the composer's "+ context" control can add back. A chip stays dismissed only
 * while its underlying context is unchanged; a new id (new trace, new dataset)
 * produces a new chip id and re-surfaces it.
 */
export function useLangyPageContext(): {
  chips: LangyContextChip[];
  addableChips: LangyContextChip[];
} {
  const { project } = useOrganizationTeamProject();
  const { experimentSlug, pageContext } = useLangy();
  // `useLocation` throws outside a <Router>. The panel is always mounted inside
  // the app's router in production, but some unit tests mount it bare — guard
  // with `useInRouterContext` (invariant per mount, so the conditional hook is
  // safe) so those tests don't crash and the panel simply has no route context.
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const pathname = inRouter ? useLocation().pathname : "";
  const dismissed = useLangyStore((s) => s.dismissedChipIds);

  const candidates = useMemo<LangyContextChip[]>(() => {
    const out: LangyContextChip[] = [];
    const seen = new Set<string>();
    const add = (chip: LangyContextChip | null) => {
      if (!chip || seen.has(chip.id)) return;
      seen.add(chip.id);
      out.push(chip);
    };

    for (const chip of routeChips(pathname)) add(chip);
    if (experimentSlug) {
      add({
        id: `experiment:${experimentSlug}`,
        kind: "experiment",
        label: `experiment: ${experimentSlug}`,
        ref: experimentSlug,
      });
    }
    for (const chip of pageContext) add(chip);
    if (project) {
      add({
        id: `project:${project.id}`,
        kind: "project",
        label: `project: ${project.name ?? project.slug}`,
      });
    }
    return out;
  }, [pathname, experimentSlug, pageContext, project]);

  return {
    chips: selectVisibleChips(candidates, dismissed),
    addableChips: selectDismissedChips(candidates, dismissed),
  };
}

/** Shorten a long id for a chip label: `3f9a01…c2`. */
function shortenId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-2)}`;
}

/**
 * Derive resource chips from the pathname. Paths look like
 * `/<projectSlug>/<surface>/<...rest>`; only the dynamic-id routes yield a
 * resource chip (index pages have no specific resource to pin).
 */
function routeChips(pathname: string): LangyContextChip[] {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // [projectSlug, surface, ...rest]
  const surface = segments[1];
  const rest = segments.slice(2);
  if (!surface || rest.length === 0) return [];

  switch (surface) {
    case "messages": {
      const trace = rest[0]!;
      return [
        {
          id: `trace:${trace}`,
          kind: "trace",
          label: `trace ${shortenId(trace)}`,
          ref: trace,
        },
      ];
    }
    case "experiments": {
      // `/experiments/<slug>` or `/experiments/workbench/<slug>`.
      const slug = rest[0] === "workbench" ? rest[1] : rest[0];
      if (!slug || slug === "index") return [];
      return [
        {
          id: `experiment:${slug}`,
          kind: "experiment",
          label: `experiment: ${slug}`,
          ref: slug,
        },
      ];
    }
    case "datasets": {
      const id = rest[0]!;
      return [
        {
          id: `dataset:${id}`,
          kind: "dataset",
          label: `dataset ${shortenId(id)}`,
          ref: id,
        },
      ];
    }
    default:
      return [];
  }
}
