/**
 * Langy's takeover after the tailor step: hello, the value question, the provider connect, then a
 * landing on the first pick's page (or a pending continuation). Phases fade through the stage.
 * @see specs/features/onboarding/guided-welcome-takeover.feature
 */
import { type GuidedPath, guidedPathLanding } from "@langwatch/onboarding-contract";
import { useEffect, useRef, useState } from "react";
import { AnalyticsBoundary } from "react-contextual-analytics";

import { onboardingApi } from "../../../../behavior/onboarding-api.ts";
import { useOnboardingHost } from "../../../../model/onboarding-host.ts";
import { greetingName, setupTarget } from "../../model/copy.ts";
import type { TakeoverPhase } from "../../model/resume.ts";
import { HelloScreen } from "./hello-screen.tsx";
import { ProviderScreen } from "./provider-screen.tsx";
import { TAKEOVER_FADE_MS, TakeoverStage } from "./takeover-stage.tsx";
import { ValueScreen } from "./value-screen.tsx";

export function GuidedTakeover({
  organizationId,
  organizationName,
  projectId,
  projectSlug,
  userName,
  usageStyle,
  initialPhase,
  initialPaths = [],
  returnTo,
}: {
  organizationId: string;
  organizationName: string;
  /** Still resolving right after creation; the provider panel waits for it. */
  projectId: string | undefined;
  projectSlug: string;
  userName: string | null | undefined;
  usageStyle: string | null | undefined;
  initialPhase: TakeoverPhase;
  initialPaths?: GuidedPath[];
  returnTo: string | null;
}) {
  const host = useOnboardingHost();
  const [phase, setPhase] = useState<TakeoverPhase>(initialPhase);
  const [fading, setFading] = useState(false);
  const [paths, setPaths] = useState<GuidedPath[]>(initialPaths);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const recordPaths = onboardingApi.onboarding.recordPaths.useMutation();

  const goto = (next: TakeoverPhase) => {
    setFading(true);
    timers.current.push(
      window.setTimeout(() => {
        setPhase(next);
        setFading(false);
      }, TAKEOVER_FADE_MS),
    );
  };

  // A full navigation: the product's shell boots fresh on the landing, with the organization and
  // the project it now has.
  const land = () => {
    const first = paths[0] ?? "llmops";
    host.hardRedirect(returnTo ?? guidedPathLanding({ path: first, projectSlug }));
  };

  const firstName = greetingName(userName);
  const target = setupTarget({ organizationName, usageStyle });

  return (
    <AnalyticsBoundary
      name="onboarding_guided"
      attributes={{ variant: "guided", phase }}
      sendViewedEvent
    >
      <TakeoverStage>
        {phase === "hello" && (
          <HelloScreen firstName={firstName} fading={fading} onNext={() => goto("value")} />
        )}
        {phase === "value" && (
          <ValueScreen
            firstName={firstName}
            target={target}
            initialPicks={paths}
            fading={fading || recordPaths.isPending}
            onNext={(picked) => {
              setPaths(picked);
              recordPaths.mutate(
                { organizationId, paths: picked },
                {
                  onSuccess: () => goto("provider"),
                  onError: (error) =>
                    host.failed({ error, fallbackTitle: "Couldn't save what you picked" }),
                },
              );
            }}
          />
        )}
        {phase === "provider" && (
          <ProviderScreen
            picksCount={paths.length}
            organizationId={organizationId}
            projectId={projectId}
            fading={fading}
            onConnected={() => {
              setFading(true);
              timers.current.push(window.setTimeout(land, 500));
            }}
            onSkip={land}
            onSkipFailed={(error) =>
              host.failed({ error, fallbackTitle: "Couldn't skip the guided tour" })
            }
          />
        )}
      </TakeoverStage>
    </AnalyticsBoundary>
  );
}
