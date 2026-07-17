import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

/**
 * A spring number ticker. On first paint it rolls up from 0 to `value`; on
 * every later change it springs from its current display to the new value.
 * Used for any metric Langy reports mid-turn ("Analysing 1,204 traces", a
 * score, a progress percent). The spring settles in well under 500ms.
 *
 * Respects `prefers-reduced-motion` — reduced-motion users see the final value
 * with no animation.
 */
export function NumberTicker({
  value,
  format,
}: {
  value: number;
  /** Custom formatter; defaults to locale-grouped integer. */
  format?: (n: number) => string;
}) {
  const reduce = useReducedMotion();
  // Seed at 0 so the value visibly rolls up on mount (set to `value` in the
  // effect below). Subsequent value changes spring from wherever it settled.
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, {
    stiffness: 200,
    damping: 26,
    mass: 0.5,
  });
  const display = useTransform(spring, (v) =>
    format ? format(Math.round(v)) : Math.round(v).toLocaleString(),
  );

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  if (reduce) {
    return (
      <span>{format ? format(value) : Math.round(value).toLocaleString()}</span>
    );
  }

  return <motion.span>{display}</motion.span>;
}
