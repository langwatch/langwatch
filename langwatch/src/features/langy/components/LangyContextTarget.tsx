import type { CSSProperties, ReactElement } from "react";
import { cloneElement } from "react";
import { useLangyContextTarget } from "../hooks/useLangyContextTarget";
import type { LangyContextTarget as LangyContextTargetDescriptor } from "../stores/langyContextTargetStore";

/**
 * Declare a thing on the page as something Langy can be pointed at — the
 * one-wrapper version of `useLangyContextTarget`.
 *
 * Wrap the element that IS the thing. While the Langy panel is open, moving the
 * pointer near it picks up a quiet outline, and hovering it floats an "Absorb
 * context" button over it which takes the resource into Langy's context. The
 * element's OWN click is never touched — a card that opens an editor still
 * opens its editor. While the panel is closed the child is handed straight
 * back, untouched: no clone, no merged props, no wrapper node.
 *
 *   <LangyContextTarget target={traceContextChip(trace.id, trace.traceName ?? trace.name)}>
 *     <Card.Root onClick={open}>…</Card.Root>
 *   </LangyContextTarget>
 *
 * Pass the trace's human name (its resolved trace name / root span name) as the
 * chip's display label, not just the id — the chip and its hover lead with a
 * name a person recognises, and keep the raw id as secondary detail. The chip
 * factories (`traceContextChip`, `datasetContextChip`, …) fall back to a
 * shortened id only when no name is known.
 *
 * The child must carry the border-radius of the thing it wraps — Langy's
 * outline follows the element's own radius, so a square wrapper around a
 * rounded card will square off its corner.
 *
 * Prefer this over the hook. Because it is a component, it can be used INLINE
 * inside a `.map()` — where a hook can't go — so a list of rows or cards opts in
 * without anyone having to extract a wrapper component first. Reach for the hook
 * directly only when the target's root is already a component you own and you'd
 * rather spread the props than nest an element (the trace table's virtualized
 * row does this, because its root is a <tbody> the virtualizer measures).
 *
 * `target` may be null — for a row that hasn't loaded, or a skeleton — which
 * makes the whole thing inert without breaking the rules of hooks.
 */
export function LangyContextTarget({
  target,
  children,
}: {
  target:
    | (LangyContextTargetDescriptor & { enabled?: boolean })
    | null
    | undefined;
  /** Exactly one element — the thing itself. Its props are merged, not replaced. */
  children: ReactElement<{ className?: string; style?: CSSProperties }>;
}) {
  const { targetProps, isActive } = useLangyContextTarget(target);

  // Langy is closed (or there's nothing to offer): hand the child back exactly
  // as it came in. Not a clone with empty props — the same element. This is the
  // "zero cost when closed" guarantee made structural: there is no code path
  // here that can touch the page.
  if (!isActive) return children;

  // Merge, never clobber. The child keeps its own className and style; Langy's
  // ring class and sheen-phase variable are added alongside them.
  return cloneElement(children, {
    ...targetProps,
    className: [children.props.className, targetProps.className]
      .filter(Boolean)
      .join(" "),
    style: { ...children.props.style, ...targetProps.style },
  } as Partial<{ className?: string; style?: CSSProperties }>);
}
