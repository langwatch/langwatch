import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { nowInstant } from "@langwatch/time";
import { useEffect, useRef } from "react";

interface ScreenLifecycleProps {
  /** The surface this screen names on its `viewed`/`exited` events. */
  boundary: string;
}

/** Announces a screen on mount and how long it was up on unmount. */
export const ScreenLifecycle: React.FC<ScreenLifecycleProps> = ({ boundary }) => {
  const analytics = useUiAnalytics();
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;

  useEffect(() => {
    analytics.track({ action: "viewed", boundary: boundaryRef.current });
    const start = nowInstant().epochMilliseconds;
    return () => {
      analytics.track({
        action: "exited",
        boundary: boundaryRef.current,
        attributes: { timeOnScreenMs: nowInstant().epochMilliseconds - start },
      });
    };
  }, [analytics]);

  return null;
};
