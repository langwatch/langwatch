import { useEffect, useRef } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { nowInstant } from "@langwatch/time";

export const ScreenLifecycle: React.FC = () => {
  const { emit } = useAnalytics();
  const emitRef = useRef(emit);
  emitRef.current = emit;

  useEffect(() => {
    const start = nowInstant().epochMilliseconds;
    return () => {
      emitRef.current("exited", void 0, {
        timeOnScreenMs: nowInstant().epochMilliseconds - start,
      });
    };
  }, []);

  return null;
};
