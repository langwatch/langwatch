import { CommandBarHint } from "@langwatch/design-system/app-shell";
import { useEffect, useState } from "react";

import { HINTS } from "../../model/command-bar-constants.ts";

/**
 * Hints section showing tips to help users.
 * Displays a random tip that stays stable for the session.
 */
export function HintsSection() {
  // Initialize to 0 for SSR, then randomize on client to avoid hydration mismatch
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    setHintIndex(Math.floor(Math.random() * HINTS.length));
  }, []);

  return <CommandBarHint hint={HINTS[hintIndex]} />;
}
