import {
  PresenceSection as ObservedSection,
  type PresenceSectionProps as ObservedSectionProps,
} from "@langwatch/design-system/presence";
import { useCallback } from "react";

import { useSectionTrackerStore } from "../../../behavior/presence/section-tracker-store.ts";

export type PresenceSectionProps = Omit<ObservedSectionProps, "onVisibility" | "onLeave">;

/** Wraps a region of the drawer body and tells the section tracker how much of it is in view. */
export function PresenceSection(props: PresenceSectionProps) {
  const setVisibility = useSectionTrackerStore((s) => s.setVisibility);
  const unregister = useSectionTrackerStore((s) => s.unregister);
  const onVisibility = useCallback(
    ({ id, ratio }: { id: string; ratio: number }) => setVisibility(id, ratio),
    [setVisibility],
  );
  const onLeave = useCallback(({ id }: { id: string }) => unregister(id), [unregister]);
  return <ObservedSection {...props} onVisibility={onVisibility} onLeave={onLeave} />;
}
