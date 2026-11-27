/**
 * One step that spans several calls (accept the price, then save), and whether it is still
 * running, so the controls it would race stay still. Spec:
 * modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import { useState } from "react";

export type InFlight = {
  inFlight: boolean;
  /** Runs the step; the flag clears when it settles, a rejection included. */
  run: (step: () => Promise<void>) => Promise<void>;
};

export function useInFlight(): InFlight {
  const [inFlight, setInFlight] = useState(false);
  return {
    inFlight,
    run: async (step) => {
      setInFlight(true);
      try {
        await step();
      } finally {
        setInFlight(false);
      }
    },
  };
}
