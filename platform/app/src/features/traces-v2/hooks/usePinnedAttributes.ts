import { useCallback, useEffect } from "react";
import {
  type PinnedAttribute,
  type PinnedAttributeSource,
  usePinnedAttributesStore,
} from "../stores/pinnedAttributesStore";

const EMPTY: PinnedAttribute[] = [];

interface UsePinnedAttributesResult {
  pins: PinnedAttribute[];
  isPinned: (source: PinnedAttributeSource, key: string) => boolean;
  togglePin: (pin: PinnedAttribute) => void;
  removePin: (source: PinnedAttributeSource, key: string) => void;
  reorder: (fromIndex: number, toIndex: number) => void;
}

export function usePinnedAttributes(
  projectId: string | undefined,
): UsePinnedAttributesResult {
  const pins = usePinnedAttributesStore((s) =>
    projectId ? (s.byProject[projectId] ?? EMPTY) : EMPTY,
  );
  const hydrate = usePinnedAttributesStore((s) => s.hydrateFromStorage);
  const togglePinAction = usePinnedAttributesStore((s) => s.togglePin);
  const removePinAction = usePinnedAttributesStore((s) => s.removePin);
  const reorderAction = usePinnedAttributesStore((s) => s.reorder);

  useEffect(() => {
    if (projectId) hydrate(projectId);
  }, [projectId, hydrate]);

  const isPinned = useCallback(
    (source: PinnedAttributeSource, key: string) =>
      pins.some((p) => p.source === source && p.key === key),
    [pins],
  );

  const togglePin = useCallback(
    (pin: PinnedAttribute) => {
      if (!projectId) return;
      togglePinAction(projectId, pin);
    },
    [projectId, togglePinAction],
  );

  const removePin = useCallback(
    (source: PinnedAttributeSource, key: string) => {
      if (!projectId) return;
      removePinAction(projectId, source, key);
    },
    [projectId, removePinAction],
  );

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!projectId) return;
      reorderAction(projectId, fromIndex, toIndex);
    },
    [projectId, reorderAction],
  );

  return { pins, isPinned, togglePin, removePin, reorder };
}
