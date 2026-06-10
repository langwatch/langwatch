import { api } from "~/utils/api";

const NEW_ACCOUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True while the signed-in user's account is less than 7 days old.
 * Onboarding affordances (the full-width "Show me around" label) only
 * earn their toolbar real estate for genuinely new users; everyone else
 * gets the compact icon-only variant. Defaults to false while the query
 * is in flight so the toolbar never flashes the wide variant at
 * long-tenured users.
 */
export function useIsNewAccount(): boolean {
  const { data } = api.user.getAccountInfo.useQuery(
    {},
    { staleTime: Infinity, refetchOnWindowFocus: false },
  );
  if (!data?.createdAt) return false;
  return Date.now() - new Date(data.createdAt).getTime() < NEW_ACCOUNT_WINDOW_MS;
}
