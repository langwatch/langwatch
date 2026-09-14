import { useLandingRedirect } from "../../../behavior/use-landing-redirect.ts";
import { useNavigationHost } from "../../../model/navigation-host.ts";

/**
 * Landing page (/): picks right home and replaces address. Shows host waiting() screen.
 * Picking logic in useLandingRedirect. Moved from platform/app.
 */
export default function LandingScreen() {
  const host = useNavigationHost();
  useLandingRedirect();

  return <>{host.waiting()}</>;
}
