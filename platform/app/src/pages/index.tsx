import { Button } from "@chakra-ui/react";
import { HandledErrorState } from "~/features/errors";
import { useLandingRedirect } from "~/features/navigation/useLandingRedirect";
import { LoadingScreen } from "../components/LoadingScreen";

/**
 * `/` picks the right home for the user and replaces the address with it.
 * The picking lives in useLandingRedirect; this page only shows the
 * loading screen while it decides.
 *
 * The exception is a workspace read that was REFUSED. There is no home to
 * pick from a graph that will not answer, so the redirect never comes and a
 * loading screen would be permanent — this is the one address with nothing
 * behind it to fall back to. It says so instead, and offers the retry that
 * covers both a transient fault and a session that has to be re-established.
 *
 * Specs: specs/ai-gateway/governance/persona-home-resolver.feature
 *        specs/navigation/navigation-v2-landing.feature
 *        specs/navigation/workspace-resolution.feature
 */
export default function Index() {
  const { workspaceError } = useLandingRedirect();

  if (workspaceError) {
    return (
      <HandledErrorState
        error={workspaceError}
        fallbackTitle="We couldn't open your workspace"
      >
        <Button
          colorPalette="orange"
          onClick={() => window.location.reload()}
          data-testid="retry-workspace"
        >
          Try again
        </Button>
      </HandledErrorState>
    );
  }

  return <LoadingScreen />;
}
