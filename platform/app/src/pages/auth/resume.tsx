import { useEffect, useRef } from "react";
import { LoadingScreen } from "~/components/LoadingScreen";
import { consumeStoredReturnTo } from "~/utils/auth-client";
import { replaceLocation } from "~/utils/browserNavigation";

/**
 * Where better-auth returns a sign-in whose real destination its callbackURL
 * check would refuse (see `betterAuthCallbackURL`). Forwards to the parked
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
