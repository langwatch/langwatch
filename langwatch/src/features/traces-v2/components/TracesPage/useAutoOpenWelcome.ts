import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { useWelcomeStore } from "../../stores/welcomeStore";

const WELCOME_SEEN_KEY = "langwatch:traces-v2:welcome-seen";

/**
 * Auto-opens the welcome dialog the first time a user lands on traces v2.
 * Lives in TracesPage (not WelcomeScreen) because WelcomeScreen mounts in
 * DashboardLayout and must not auto-open on other pages.
 */
export const useAutoOpenWelcome = (): void => {
  const isOpen = useWelcomeStore((s) => s.isOpen);
  const open = useWelcomeStore((s) => s.open);
  const [seen] = useLocalStorage<boolean>(WELCOME_SEEN_KEY, false);

  useEffect(() => {
    if (!seen && !isOpen) open();
  }, [seen, isOpen, open]);
};
