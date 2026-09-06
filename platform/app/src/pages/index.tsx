import { useLandingRedirect } from "~/features/navigation/useLandingRedirect";
import { LoadingScreen } from "../components/LoadingScreen";

/**
 * `/` picks the right home for the user and replaces the address with it.
 * The picking lives in useLandingRedirect; this page only shows the
 * loading screen while it decides.
 *
 * Specs: specs/ai-gateway/governance/persona-home-resolver.feature
 *        specs/navigation/navigation-v2-landing.feature
 */
export default function Index() {
  useLandingRedirect();

  return <LoadingScreen />;
}
