import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

/**
 * A spring number ticker: animates from its previous value to the new one with
 * a spring, for any metric Langy reports mid-turn ("Analysing 1,204 traces",
 * a score, a count). Respects `prefers-reduced-motion` — reduced-motion users
 * see the final value with no animation.
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
  const motionValue = useMotionValue(value);
  const spring = useSpring(motionValue, {
    stiffness: 120,
    damping: 20,
    mass: 0.6,
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
