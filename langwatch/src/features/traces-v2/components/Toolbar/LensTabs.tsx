import { Box, Button, HStack, Tabs } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import type React from "react";
import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "../../../../components/ui/menu";
import { useErrorCount } from "../../hooks/useErrorCount";
import type { LensConfig } from "../../stores/viewStore";
import { useViewStore } from "../../stores/viewStore";
import { CreateLensButton } from "./CreateLensButton";
import { LensTab } from "./LensTab";
import { UnsavedLensDialog } from "./UnsavedLensDialog";

const ERRORS_LENS_ID = "errors";

export const LensTabs: React.FC = () => {
  const activeLensId = useViewStore((s) => s.activeLensId);
  const allLenses = useViewStore((s) => s.allLenses);
  const selectLens = useViewStore((s) => s.selectLens);
  const saveAsNewLens = useViewStore((s) => s.saveAsNewLens);
  const revertLens = useViewStore((s) => s.revertLens);
  const isDraft = useViewStore((s) => s.isDraft);
  const errorCount = useErrorCount();

  const [pendingLensId, setPendingLensId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hiddenIds = useHiddenLensTabs(scrollerRef, allLenses, activeLensId);

  const activeLens = allLenses.find((l) => l.id === activeLensId);
  const activeLensIsDraft = isDraft(activeLensId);
  // Preserve `allLenses` order in the overflow menu — `Set.has` lookup keeps
  // the filter cheap.
  const hiddenLenses = useMemo(
    () => allLenses.filter((l) => hiddenIds.has(l.id)),
    [allLenses, hiddenIds],
  );

  const handleLensChange = (targetId: string) => {
    if (targetId === activeLensId) return;
    if (activeLens && !activeLens.isBuiltIn && activeLensIsDraft) {
      setPendingLensId(targetId);
      return;
    }
    startTransition(() => selectLens(targetId));
  };

  const resolvePendingDiscard = () => {
    revertLens(activeLensId);
    if (pendingLensId) {
      const target = pendingLensId;
      startTransition(() => selectLens(target));
    }
    setPendingLensId(null);
  };

  // Saving as a new lens already activates that new lens, so we drop the
  // pending switch — the user opted to keep their work, switching them away
  // afterwards would defeat the gesture.
  const resolvePendingSaveAsNew = () => {
    if (typeof window === "undefined") return;
    const defaultName = `${activeLens?.name ?? "Lens"} (copy)`;
    const name = window.prompt("Save as new lens — name:", defaultName);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    saveAsNewLens(trimmed);
    setPendingLensId(null);
  };

  const handleOverflowSelect = (id: string) => {
    handleLensChange(id);
    const root = scrollerRef.current;
    if (!root) return;
    const tab = root.querySelector<HTMLElement>(`[data-value="${id}"]`);
    tab?.scrollIntoView({
      behavior: "smooth",
      inline: "nearest",
      block: "nearest",
    });
  };

  return (
    <>
      <HStack gap={0} flex="1" minWidth={0}>
        <Tabs.Root
          value={activeLensId}
          onValueChange={(e) => handleLensChange(e.value)}
          variant="line"
          size="sm"
          fontSize="xs"
          colorPalette="orange"
          borderBottomWidth={0}
          marginBottom="-5px"
          flex="1"
          minWidth={0}
        >
          <Box ref={scrollerRef} overflowX="hidden" flex="1" minWidth={0}>
            <HStack
              gap={0}
              flexWrap="nowrap"
              width="max-content"
              align="center"
            >
              <Tabs.List borderBottomWidth={0} flexWrap="nowrap">
                {allLenses.map((lens) => (
                  <LensTab
                    key={lens.id}
                    lens={lens}
                    isDraft={isDraft(lens.id)}
                    errorCount={lens.id === ERRORS_LENS_ID ? errorCount : 0}
                    hidden={hiddenIds.has(lens.id)}
                  />
                ))}
              </Tabs.List>
              {/* `+` lives inside the same horizontal scroller, immediately
                  after the last tab — sits next to the lenses regardless of
                  how much room the toolbar has. */}
              <CreateLensButton />
            </HStack>
          </Box>
        </Tabs.Root>
        <OverflowMenu
          hiddenLenses={hiddenLenses}
          activeLensId={activeLensId}
          onSelect={handleOverflowSelect}
        />
      </HStack>

      <UnsavedLensDialog
        open={pendingLensId !== null}
        lensName={activeLens?.name ?? ""}
        onSaveAsNew={resolvePendingSaveAsNew}
        onDiscard={resolvePendingDiscard}
        onCancel={() => setPendingLensId(null)}
      />
    </>
  );
};

// Reserve enough headroom in the scroller for the inline `+` button plus the
// overflow `⋮` trigger that lives just outside the scroller. If a tab's right
// edge would land past `containerRight - OVERFLOW_RESERVE_PX`, we drop the
// whole tab into the overflow menu instead of letting it clip.
const OVERFLOW_RESERVE_PX = 56;

/**
 * First-fit overflow: measure each tab's right edge against the scroller,
 * and once one would clip, drop it (and every subsequent tab) into the
 * overflow menu. Two-phase to avoid thrashing — when the lens list changes
 * or the container resizes we reset to "all visible", let layout settle,
 * then pick a fresh cutoff in `useLayoutEffect`. We never *un*-hide based
 * on settled state, so we converge in a single measurement pass per
 * input change.
 */
function useHiddenLensTabs(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  allLenses: LensConfig[],
  activeLensId: string,
): Set<string> {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [measureSeq, setMeasureSeq] = useState(0);

  // Reset on lens list change or active-lens change (the active tab is
  // force-visible, so re-measure when it moves).
  useEffect(() => {
    setHiddenIds(EMPTY_SET);
    setMeasureSeq((s) => s + 1);
  }, [allLenses, activeLensId]);

  // Reset on container resize so a wider toolbar can re-show tabs.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      setHiddenIds(EMPTY_SET);
      setMeasureSeq((s) => s + 1);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [scrollerRef]);

  // Measurement pass — only runs while every tab is on-screen, i.e. right
  // after a reset. Once we've assigned a cutoff we exit early so subsequent
  // re-renders don't bounce.
  useLayoutEffect(() => {
    if (hiddenIds.size > 0) return;
    const root = scrollerRef.current;
    if (!root) return;

    const tabs = Array.from(root.querySelectorAll<HTMLElement>("[data-value]"));
    if (tabs.length === 0) return;

    const containerRect = root.getBoundingClientRect();
    const limit = containerRect.right - OVERFLOW_RESERVE_PX;

    const next = new Set<string>();
    const visibleIds: string[] = [];
    let cutoff = false;
    for (const tab of tabs) {
      const id = tab.getAttribute("data-value");
      if (!id) continue;
      if (cutoff) {
        next.add(id);
        continue;
      }
      const rect = tab.getBoundingClientRect();
      if (rect.right > limit) {
        next.add(id);
        cutoff = true;
      } else {
        visibleIds.push(id);
      }
    }

    // Active tab must always be visible — otherwise the Tabs underline
    // points at a `display: none` element and the user can't see what
    // they just selected. Swap with the last visible tab to make room.
    if (next.has(activeLensId) && visibleIds.length > 0) {
      const sacrifice = visibleIds[visibleIds.length - 1]!;
      next.delete(activeLensId);
      next.add(sacrifice);
    }

    if (next.size > 0) setHiddenIds(next);
  }, [measureSeq, hiddenIds, allLenses, scrollerRef, activeLensId]);

  return hiddenIds;
}

const EMPTY_SET: Set<string> = new Set();

interface OverflowMenuProps {
  hiddenLenses: LensConfig[];
  activeLensId: string;
  onSelect: (id: string) => void;
}

const OverflowMenu: React.FC<OverflowMenuProps> = ({
  hiddenLenses,
  activeLensId,
  onSelect,
}) => {
  if (hiddenLenses.length === 0) return null;
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          paddingX={0.5}
          minWidth="auto"
          height="22px"
          color="fg.muted"
          aria-label={`Show ${hiddenLenses.length} more lenses`}
        >
          <MoreVertical size={14} />
        </Button>
      </MenuTrigger>
      <MenuContent minWidth="180px">
        {hiddenLenses.map((lens) => (
          <MenuItem
            key={lens.id}
            value={lens.id}
            onClick={() => onSelect(lens.id)}
            fontWeight={lens.id === activeLensId ? "semibold" : undefined}
          >
            {lens.name}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
};
