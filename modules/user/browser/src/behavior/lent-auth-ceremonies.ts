/**
 * The passkey and two-step ceremonies auth lends through its declaration: the
 * better-auth client stays auth's, and this workspace's host calls through.
 * ARCHITECTURE.md §10.1 "A capability travels by declaration", kit rule 7.
 */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiDeclaredCapabilities } from "@langwatch/browser-host/declarations";
import { useMemo } from "react";

/** What auth lent, where it lent it; absent is what a composition without auth reads. */
export type LentAuthCeremonies = {
  passkeys?: UiDeclaredCapabilities["passkeys"];
  twoStepVerification?: UiDeclaredCapabilities["twoStepVerification"];
};

export function useLentAuthCeremonies(): LentAuthCeremonies {
  const declarations = useUiDeclarations();
  return useMemo(
    () => ({
      passkeys: declarations.declared("passkeys")[0]?.capability,
      twoStepVerification: declarations.declared("twoStepVerification")[0]?.capability,
    }),
    [declarations],
  );
}
