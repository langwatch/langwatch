import type { CSSProperties, ReactElement } from "react";
import { cloneElement } from "react";
import { useLangyContextTarget } from "../../behavior/use-langy-context-target";
import type { LangyContextTarget as LangyContextTargetDescriptor } from "../../behavior/langy-context-target.store";

/**
 * Declare a thing on the page as something Langy can be pointed at — the one-wrapper
 * version of `useLangyContextTarget`.
 */
export function LangyContextTarget({
  target,
  children,
}: {
  target: (LangyContextTargetDescriptor & { enabled?: boolean }) | null | undefined;
  /** Exactly one element — the thing itself. Its props are merged, not replaced. */
  children: ReactElement<{ className?: string; style?: CSSProperties }>;
}) {
  const { targetProps, isActive } = useLangyContextTarget(target);

  // Nothing to offer, or nothing armed: hand the child back exactly as it came
  // in. Not a clone with empty props — the same element. This is the "zero cost
  // when disarmed" guarantee made structural: there is no code path here that
  // can touch the page.
  if (!isActive || !targetProps["data-langy-target"]) return children;

  // Merge, never clobber. The child keeps its own className and style; Langy's
  // ring class and sheen-phase variable are added alongside them.
  return cloneElement(children, {
    ...targetProps,
    className: [children.props.className, targetProps.className].filter(Boolean).join(" "),
    style: { ...children.props.style, ...targetProps.style },
  } as Partial<{ className?: string; style?: CSSProperties }>);
}
