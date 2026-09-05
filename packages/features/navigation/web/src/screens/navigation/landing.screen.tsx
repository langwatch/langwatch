import { useLandingRedirect } from "../../behavior/use-landing-redirect";
import { useNavigationHost } from "../../model/navigation-host";

/**
 * `/` picks the right home for the user and replaces the address with it.
 * The picking lives in useLandingRedirect; this page only shows the
 * loading screen while it decides.
 *
 * MOVED from `platform/app/src/pages/index.tsx`. The wait itself is the host's:
 * that page rendered `platform/app`'s `LoadingScreen`, a motion-driven
 * full-logo screen with thirteen other callers there, and a package may not
 * reach for another application's chrome. `waiting()` is the port's answer, the
 * same shape `projectSwitcher()` takes.
 *
 * Specs: specs/ai-gateway/governance/persona-home-resolver.feature
 *        specs/navigation/navigation-v2-landing.feature
 */
export default function LandingScreen() {
  const host = useNavigationHost();
  useLandingRedirect();

  return <>{host.waiting()}</>;
}
