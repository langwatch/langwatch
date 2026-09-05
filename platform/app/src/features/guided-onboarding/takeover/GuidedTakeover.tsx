import { useEffect, useRef, useState } from "react";
import { AnalyticsBoundary } from "react-contextual-analytics";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { type GuidedPath, guidedPathLanding } from "../paths";
import { greetingName, setupTarget } from "./copy";
import { HelloScreen } from "./HelloScreen";
import { navigateTo } from "./navigate";
import { ProviderScreen } from "./ProviderScreen";
import type { TakeoverPhase } from "./resume";
import { TAKEOVER_FADE_MS, TakeoverStage } from "./TakeoverStage";
import { ValueScreen } from "./ValueScreen";

/**
 * Langy's takeover after the tailor step: hello, the value question, the
 * provider connect. The organization and its project already exist; every
 * answer is written to the organization as it is given, and the flow ends
 * by landing on the first pick's page (or on a pending continuation).
 *
 * Phases fade through the stage: the leaving screen fades out over
 * TAKEOVER_FADE_MS, then the next one mounts and types.
 */
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
  codexAvailable,
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
  codexAvailable: boolean;
}) {
  const [phase, setPhase] = useState<TakeoverPhase>(initialPhase);
  const [fading, setFading] = useState(false);
  const [paths, setPaths] = useState<GuidedPath[]>(initialPaths);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const recordPaths = api.onboarding.recordPaths.useMutation();
  const recordProviderSkipped =
    api.onboarding.recordProviderSkipped.useMutation();

  const goto = (next: TakeoverPhase) => {
    setFading(true);
    timers.current.push(
      window.setTimeout(() => {
        setPhase(next);
        setFading(false);
      }, TAKEOVER_FADE_MS),
    );
  };

  const land = () => {
    const first = paths[0] ?? "llmops";
    navigateTo(returnTo ?? guidedPathLanding({ path: first, projectSlug }));
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
          <HelloScreen
            firstName={firstName}
            fading={fading}
            onNext={() => goto("value")}
          />
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
                    showErrorToast({
                      error,
                      fallbackTitle: "Couldn't save what you picked",
                    }),
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
            codexAvailable={codexAvailable}
            fading={fading}
            onConnected={() => {
              setFading(true);
              timers.current.push(window.setTimeout(land, 500));
            }}
            onSkip={() => {
              recordProviderSkipped.mutate(
                { organizationId },
                {
                  onSuccess: land,
                  onError: (error) =>
                    showErrorToast({
                      error,
                      fallbackTitle: "Couldn't skip the guided tour",
                    }),
                },
              );
            }}
          />
        )}
      </TakeoverStage>
    </AnalyticsBoundary>
  );
}
