/**
 * What a front-door screen is mounted inside: the tRPC Provider its hooks
 * run on, and the host port for deployment and address. Pathname comes off
 * `useUiAddress`, not route reading, since `react-router` is sealed off here.
 */

import { AuthHostProvider, type AuthHostPort } from "@langwatch/auth-web/screens/auth";
import { readPublicAppConfig, toPublicEnvironment } from "@langwatch/ui/public-config";
import { useMemo, type ReactNode } from "react";

import { useUiAddress } from "../../../../behavior/ui-address";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";

export function AuthHost({ children }: { children: ReactNode }) {
  const { route, feedback } = useUiCapabilities();
  const reading = route.reading();
  const address = useUiAddress();
  const pathname = address.split("?")[0]?.split("#")[0] ?? "/";

  const host = useMemo<AuthHostPort>(
    () => ({
      publicEnvironment: () => toPublicEnvironment(readPublicAppConfig()),
      route: () => ({ pathname, params: reading.params, query: reading.query }),
      // The application's own feedback capability, so a refused sign-in reads
      // the code-keyed registry rather than a sentence the screen wrote.
      failed: (failure) => feedback.failed(failure),
    }),
    [pathname, reading.params, reading.query, feedback],
  );

  return <AuthHostProvider value={host}>{children}</AuthHostProvider>;
}
