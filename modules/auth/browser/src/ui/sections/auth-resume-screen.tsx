import { LoadingScreen } from "@langwatch/design-system/loading-screen";
import { useEffect, useRef } from "react";

import { consumeStoredReturnTo } from "../../behavior/auth-client.tsx";
import { replaceLocation } from "../../behavior/browser-navigation.ts";

/**
 * Where better-auth returns a sign-in whose real destination its callbackURL
 * check would refuse (see `auth-client.tsx`). Forwards to the parked
 * destination, replacing this page so the back button skips it.
 */
export default function AuthResume() {
  // StrictMode runs the effect twice; the second run would find storage
  // already consumed and overwrite the navigation with "/".
  const resumed = useRef(false);

  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    replaceLocation(consumeStoredReturnTo());
  }, []);

  return <LoadingScreen />;
}
