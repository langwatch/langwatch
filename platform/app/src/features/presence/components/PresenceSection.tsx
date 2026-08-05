import { Box, type BoxProps } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { useSectionTrackerStore } from "../stores/sectionTrackerStore";

interface PresenceSectionProps extends BoxProps {
  /** Stable identifier for this section ("input", "output", "evals"…). */
  id: string;
  /** Scroll container the IntersectionObserver should observe within. */
  rootRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const OBSERVER_THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1];

/**
 * Wraps a region of the drawer body so that we can broadcast which section
 * the current user is reading. Uses a single-element IntersectionObserver
 * per section that publishes its visibility ratio into a shared zustand
 * store; the store derives "most visible" and the presence hook ships it
 * up to peers as `view.section`.
 *
 * Pure UI affordance — invisible to the local user; the section attribute
 * is only ever rendered remotely on a peer's screen.
 */
export function PresenceSection({
  id,
  rootRef,
  children,
  ...boxProps
}: PresenceSectionProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const setVisibility = useSectionTrackerStore((s) => s.setVisibility);
  const unregister = useSectionTrackerStore((s) => s.unregister);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setVisibility(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
      },
      {
        root: rootRef?.current ?? null,
        threshold: OBSERVER_THRESHOLDS,
      },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      unregister(id);
    };
  }, [id, rootRef, setVisibility, unregister]);

  return (
    <Box ref={ref} data-presence-section={id} {...boxProps}>
      {children}
    </Box>
  );
}
