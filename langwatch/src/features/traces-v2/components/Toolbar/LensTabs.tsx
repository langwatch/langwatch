import { Box, HStack, IconButton, Tabs, Text } from "@chakra-ui/react";
import { PanelLeftOpen } from "lucide-react";
import type React from "react";
import { startTransition, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
import { useErrorCount } from "../../hooks/useErrorCount";
import { useOverflowVisibility } from "../../hooks/useOverflowVisibility";
import { useUIStore } from "../../stores/uiStore";
import { useViewStore } from "../../stores/viewStore";
import { OverflowMenu } from "../shared/OverflowMenu";
import { CreateLensButton } from "./CreateLensButton";
import { LensTab } from "./LensTab";
import { UnsavedLensDialog } from "./UnsavedLensDialog";

const ERRORS_LENS_ID = "errors";
// Headroom reserved on the right edge of the scroller for the inline
// "+" button + the overflow "⋮" trigger sitting just outside it.
const LENS_OVERFLOW_RESERVE_PX = 56;

export const LensTabs: React.FC = () => {
  const activeLensId = useViewStore((s) => s.activeLensId);
  const allLenses = useViewStore((s) => s.allLenses);
  const selectLens = useViewStore((s) => s.selectLens);
  const createLens = useViewStore((s) => s.createLens);
  const revertLens = useViewStore((s) => s.revertLens);
  const isDraft = useViewStore((s) => s.isDraft);
  const errorCount = useErrorCount();

  const [pendingLensId, setPendingLensId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lensIds = useMemo(() => allLenses.map((l) => l.id), [allLenses]);
  const hiddenIds = useOverflowVisibility({
    scrollerRef,
    items: lensIds,
    activeId: activeLensId,
    reservePx: LENS_OVERFLOW_RESERVE_PX,
    // Chakra's `Tabs.Trigger` already emits `data-value` on each tab,
    // so we reuse it instead of duplicating the attribute on every
    // `LensTab`.
    attribute: "data-value",
  });

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const activeLens = allLenses.find((l) => l.id === activeLensId);
  const activeLensIsDraft = isDraft(activeLensId);
  const overflowItems = useMemo(
    () =>
      allLenses
        .filter((l) => hiddenIds.has(l.id))
        .map((l) => ({ id: l.id, label: l.name })),
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
    createLens(trimmed);
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
        {sidebarCollapsed && (
          <Tooltip
            content={
              <HStack gap={1.5}>
                <Text>Show filters sidebar</Text>
                <Kbd>{"["}</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <IconButton
              aria-label="Show filters sidebar"
              variant="ghost"
              size="2xs"
              color="fg.subtle"
              onClick={toggleSidebar}
              marginRight={1}
              flexShrink={0}
            >
              <PanelLeftOpen size={14} />
            </IconButton>
          </Tooltip>
        )}
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
          items={overflowItems}
          activeId={activeLensId}
          onSelect={handleOverflowSelect}
          ariaLabel={`Show ${overflowItems.length} more lenses`}
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

