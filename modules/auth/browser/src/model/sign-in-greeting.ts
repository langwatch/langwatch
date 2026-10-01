/**
 * The log-in card's title and intro. A returning person whose session aged out
 * is told the one true thing, not greeted as a stranger nor told something failed.
 */
export function signInGreeting(recoveredEmail: string | null): {
  title: string;
  intro?: string;
} {
  if (!recoveredEmail) return { title: "Log in to LangWatch" };
  return {
    title: "Welcome back",
    intro: "Your session expired while you were away. Log in again to pick up where you left off.",
  };
}
