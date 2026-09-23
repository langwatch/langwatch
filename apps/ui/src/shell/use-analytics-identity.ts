import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useActiveScope, useSession } from "@langwatch/browser-host/session";
import { useEffect, useRef } from "react";

/**
 * Tells analytics who is reading and which organization they are in, from the
 * session the shell resolved: a person signing in is identified, a switch to
 * another person resets first, and leaving the signed-in application forgets them.
 */
export function useAnalyticsIdentity(): void {
  const analytics = useUiAnalytics();
  const session = useSession();
  const scope = useActiveScope();
  const previousUserId = useRef<string | null>(null);

  const userId = session.user?.id ?? null;
  const email = session.user?.email ?? null;
  useEffect(() => {
    if (previousUserId.current && previousUserId.current !== userId) analytics.reset();
    previousUserId.current = userId;
    if (userId) analytics.identify({ id: userId, email });
  }, [analytics, userId, email]);

  const organizationId = scope.organization?.id;
  const organizationName = scope.organization?.name;
  useEffect(() => {
    if (!userId || !organizationId) return;
    analytics.group({ id: organizationId, name: organizationName });
  }, [analytics, userId, organizationId, organizationName]);

  useEffect(() => () => analytics.reset(), [analytics]);
}
