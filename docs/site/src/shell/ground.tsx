import { Box } from "@langwatch/design-system/primitives";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import "../../../../packages/design-system/src/components/brand/ambient-ground.css";

const LiveGround = lazy(() =>
  import("@langwatch/design-system/ambient-ground").then(({ AmbientGround }) => ({
    default: AmbientGround,
  })),
);

/** Only the visible home masthead loads the shader; reduced motion keeps the CSS floor. */
export function PageGround({ home }: { home: boolean }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!home || reduceMotion || !element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [home, reduceMotion]);
  return (
    <Box ref={ref} className="docs-ground" data-home={home} pointerEvents="none" aria-hidden="true">
      <div className="lw-ambient-ground">
        <div className="lw-ambient-ground-static" />
      </div>
      {home && visible && !reduceMotion ? (
        <Suspense fallback={null}>
          <LiveGround protect="left" />
        </Suspense>
      ) : null}
    </Box>
  );
}
