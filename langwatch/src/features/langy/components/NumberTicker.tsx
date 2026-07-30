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
/**
 * A counter reads best as a whole number, but a value below one is not a
 * counter — it is a measurement, and rounding it away leaves "0" where the
 * whole point was the magnitude. So: whole numbers for anything at or above
 * one, significant digits below it.
 */
function defaultFormat(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) >= 1) return Math.round(value).toLocaleString();
  return Number(value.toPrecision(3)).toString();
}

export function NumberTicker({
  value,
  format,
}: {
  value: number;
  /** Custom formatter; owns presentation entirely and receives the real value. */
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
  // Rounding happened HERE, before `format` ever saw the number — so a cost of
  // 0.432559 was handed to the formatter as 0 and rendered as "0". Any figure
  // smaller than one was displayed as nothing at all, which is the worst
  // possible failure for a cost: it reads as free.
  //
  // A caller that passes `format` owns the presentation entirely and gets the
  // real value. Only the bare path rounds, and it rounds for DISPLAY of a
  // counter — and even then it keeps fractions that would otherwise vanish.
  const display = useTransform(spring, (v) =>
    format ? format(v) : defaultFormat(v),
  );

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  if (reduce) {
    // Identical to the animated branch. These two used to disagree — the
    // animated one rounded before formatting and this one did not — so a
    // fractional value rendered differently for reduced-motion users.
    return <span>{format ? format(value) : defaultFormat(value)}</span>;
  }

  return <motion.span>{display}</motion.span>;
}
