import "../../model/ambient.d.ts";
import "./auth-front-door.css";

/**
 * One soft ring, once, where something has just worked — the smallest
 * possible acknowledgement, a dot and a ring that expands and is gone.
 * Does not run at all for somebody who asked for less motion.
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
