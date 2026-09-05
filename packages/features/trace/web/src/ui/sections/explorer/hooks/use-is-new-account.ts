import { api } from "../../../../behavior/trace-api";

const NEW_ACCOUNT_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * True while the signed-in user's account is less than 5 days old. Onboarding
 * affordances (the full-width "Show me around" label) only earn their toolbar real
 * estate for genuinely new users; everyone else gets the compact icon-only variant.
 */
export function useIsNewAccount(): boolean {
  const { data } = api.user.getAccountInfo.useQuery(
    {},
    { staleTime: Infinity, refetchOnWindowFocus: false },
  );
  if (!data?.createdAt) return false;
  return Date.now() - new Date(data.createdAt).getTime() < NEW_ACCOUNT_WINDOW_MS;
}
