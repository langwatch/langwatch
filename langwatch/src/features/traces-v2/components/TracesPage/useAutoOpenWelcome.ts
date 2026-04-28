import { useEffect } from "react";
import { useWelcomeSeen } from "../../hooks/useWelcomeSeen";
import { useWelcomeStore } from "../../stores/welcomeStore";

/**
 * Auto-opens the welcome dialog the first time a user lands on traces v2.
 * Lives in TracesPage (not WelcomeScreen) because WelcomeScreen mounts in
 * DashboardLayout and must not auto-open on other pages.
 */
export const useAutoOpenWelcome = (): void => {
  const isOpen = useWelcomeStore((s) => s.isOpen);
  const open = useWelcomeStore((s) => s.open);
  const { seen, hydrated } = useWelcomeSeen();

  useEffect(() => {
    if (hydrated && !seen && !isOpen) open();
  }, [hydrated, seen, isOpen, open]);
};
