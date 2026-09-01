import "../authFrontDoor.css";

/**
 * One soft ring, once, where something has just worked: an address confirmed,
 * an account created. It is the smallest possible acknowledgement — a dot and
 * a ring that expands and is gone — and it does not run at all for somebody
 * who has asked for less motion.
 */
export function SuccessPulse({ label }: { label: string }) {
  return (
    <span
      className="lw-front-door-pulse"
      role="img"
      aria-label={label}
      data-testid="success-pulse"
    />
  );
}
