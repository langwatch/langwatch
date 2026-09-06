import { api } from "~/utils/api";

const NEW_ACCOUNT_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * True while the signed-in user's account is less than 5 days old.
 * Onboarding affordances (the full-width "Show me around" label) only
 * earn their toolbar real estate for genuinely new users; everyone else
 * gets the compact icon-only variant. Defaults to false while the query
 * is in flight so the toolbar never flashes the wide variant at
 * long-tenured users. See
 * specs/traces-v2/tour-visibility-and-persistence.feature
 */
export function useIsNewAccount(): boolean {
  const { data } = api.user.getAccountInfo.useQuery(
    {},
    { staleTime: Infinity, refetchOnWindowFocus: false },
  );
  if (!data?.createdAt) return false;
  return (
    Date.now() - new Date(data.createdAt).getTime() < NEW_ACCOUNT_WINDOW_MS
  );
}
