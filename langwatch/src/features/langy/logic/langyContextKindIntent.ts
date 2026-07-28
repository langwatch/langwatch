import type { LangyRevealableKind } from "../stores/langyContextTargetStore";

/**
 * What `#trace` MEANS when there is no specific trace to pick.
 *
 * The `#` palette lists the chips already in reach and the targets mounted on
 * the page. But the user who types `#trace` on the datasets page is not naming
 * a resource — they are naming a KIND, and the honest answers are one of two:
 *
 *   reveal — targets of that kind ARE on this page: light them up for a moment
 *            so the user can see what can be taken ("Show traces on this page").
 *   browse — nothing of that kind is here: take them to the surface that has
 *            them, and let the pending reveal light the arrivals up.
 *
 * This module is the pure part: query string in, intent out. Navigation and
 * the actual reveal live with the callers (the panel owns the router, the
 * target store owns the glow).
 */
export interface LangyKindIntent {
  kind: LangyRevealableKind;
  action: "reveal" | "browse";
  /** The palette row's title. */
  label: string;
  /** The palette row's detail line. */
  detail: string;
}

/** How each kind reads in the palette, and every alias `#` should answer to. */
const KIND_VOCABULARY: Record<
  LangyRevealableKind,
  { plural: string; aliases: string[] }
> = {
  trace: { plural: "traces", aliases: ["trace", "traces", "message", "messages"] },
  dataset: { plural: "datasets", aliases: ["dataset", "datasets"] },
  prompt: { plural: "prompts", aliases: ["prompt", "prompts"] },
  evaluation: {
    plural: "evaluations",
    aliases: ["evaluation", "evaluations", "eval", "evals", "evaluator", "evaluators", "monitor", "monitors"],
  },
  scenario: {
    plural: "simulations",
    aliases: ["scenario", "scenarios", "simulation", "simulations"],
  },
  experiment: { plural: "experiments", aliases: ["experiment", "experiments"] },
  workflow: {
    plural: "workflows",
    aliases: ["workflow", "workflows", "studio"],
  },
  agent: { plural: "agents", aliases: ["agent", "agents"] },
  automation: {
    plural: "automations",
    aliases: [
      "automation",
      "automations",
      "trigger",
      "triggers",
      "alert",
      "alerts",
    ],
  },
  annotation: {
    plural: "annotations",
    aliases: ["annotation", "annotations", "queue", "queues"],
  },
  dashboard: {
    plural: "dashboards",
    aliases: ["dashboard", "dashboards", "report", "reports", "analytics"],
  },
};

/**
 * Where "browse" goes, as the `/<projectSlug>/<surface>` segment.
 *
 * The destination is the page that REGISTERS targets of the kind, which is not
 * always the page named after it. `/evaluations` is titled "Experiments" and its
 * rows declare themselves experiments; the pages whose cards declare themselves
 * evaluations are `/evaluators` and `/online-evaluations`. Sending "Browse
 * evaluations" to `/evaluations` therefore landed on a page where the promised
 * "anything that lights up can be added as context" lit nothing at all.
 */
export const SURFACE_PATH_FOR_KIND: Record<LangyRevealableKind, string> = {
  trace: "traces",
  dataset: "datasets",
  prompt: "prompts",
  evaluation: "evaluators",
  scenario: "simulations",
  experiment: "evaluations",
  workflow: "workflows",
  agent: "agents",
  automation: "automations",
  annotation: "annotations",
  dashboard: "analytics",
};

/** Don't offer "browse traces" off a single `t` — too eager to mean anything. */
const MIN_QUERY_LENGTH = 2;

/**
 * The kind the query is reaching for, or null when it isn't naming one.
 * Prefix-matched against the aliases, so `#tra`, `#trace` and `#traces` all
 * land on the same intent.
 */
export function kindIntentForQuery({
  query,
  presentKinds,
}: {
  query: string;
  /** The kinds with at least one target mounted on the current page. */
  presentKinds: ReadonlySet<string>;
}): LangyKindIntent | null {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return null;

  for (const [kind, vocabulary] of Object.entries(KIND_VOCABULARY) as [
    LangyRevealableKind,
    (typeof KIND_VOCABULARY)[LangyRevealableKind],
  ][]) {
    if (!vocabulary.aliases.some((alias) => alias.startsWith(q))) continue;

    const { plural } = vocabulary;
    if (presentKinds.has(kind)) {
      return {
        kind,
        action: "reveal",
        label: `Show ${plural} on this page`,
        detail: `Anything that lights up can be added as context`,
      };
    }
    return {
      kind,
      action: "browse",
      label: `Browse ${plural}`,
      detail: `Opens ${plural} — anything that lights up can be added as context`,
    };
  }

  return null;
}

/**
 * Every kind as a palette intent — the empty `#` palette's fallback. With
 * nothing pickable on the page, the picker offers the doors ("Browse traces",
 * "Show datasets on this page") instead of dead-ending on an empty list.
 */
export function allKindIntents(
  presentKinds: ReadonlySet<string>,
): LangyKindIntent[] {
  return (
    Object.entries(KIND_VOCABULARY) as [
      LangyRevealableKind,
      (typeof KIND_VOCABULARY)[LangyRevealableKind],
    ][]
  ).map(([kind, { plural }]) =>
    presentKinds.has(kind)
      ? {
          kind,
          action: "reveal",
          label: `Show ${plural} on this page`,
          detail: `Anything that lights up can be added as context`,
        }
      : {
          kind,
          action: "browse",
          label: `Browse ${plural}`,
          detail: `Opens ${plural} — anything that lights up can be added as context`,
        },
  );
}
