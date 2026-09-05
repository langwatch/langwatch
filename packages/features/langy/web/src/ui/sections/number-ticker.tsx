import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";
import { useReducedMotion } from "../../behavior/use-reduced-motion";

/**
 * A spring number ticker.
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
  // Rounding happened HERE, before `format` ever saw the number — so a cost of 0.432559
  // was handed to the formatter as 0 and rendered as "0".
  const display = useTransform(spring, (v) => (format ? format(v) : defaultFormat(v)));

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
