/**
 * Langy's takeover after the tailor step: hello, then the value question.
 * Phases fade through the stage. @see specs/features/onboarding/guided-welcome-takeover.feature
 */
import type { GuidedPath } from "@langwatch/onboarding-contract";
import { useEffect, useRef, useState } from "react";
import { AnalyticsBoundary } from "react-contextual-analytics";

import { onboardingApi } from "../../../../behavior/onboarding-api.ts";
import { useOnboardingHost } from "../../../../model/onboarding-host.ts";
import { greetingName, setupTarget } from "../../model/copy.ts";
import type { TakeoverPhase } from "../../model/resume.ts";
import { HelloScreen } from "./hello-screen.tsx";
import { TAKEOVER_FADE_MS, TakeoverStage } from "./takeover-stage.tsx";
import { ValueScreen } from "./value-screen.tsx";

/**
 * The provider phase (ProviderScreen) is not ported yet — see the handoff.
 * `returnTo` and the land-on-completion navigation return with it.
 */
export function GuidedTakeover({
  organizationId,
  organizationName,
  userName,
  usageStyle,
  initialPhase,
  initialPaths = [],
}: {
  organizationId: string;
  organizationName: string;
  userName: string | null | undefined;
  usageStyle: string | null | undefined;
  initialPhase: TakeoverPhase;
  initialPaths?: GuidedPath[];
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
        {/* phase === "provider" renders ProviderScreen once it is ported; see the handoff. */}
      </TakeoverStage>
    </AnalyticsBoundary>
  );
}
