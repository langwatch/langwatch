import { Box, Button, HStack, IconButton, Tabs, Text } from "@chakra-ui/react";
import { ChevronDown, PanelLeftOpen, RotateCcw } from "lucide-react";
import type React from "react";
import { startTransition, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "../../../../components/ui/menu";
import { useErrorCount } from "../../hooks/useErrorCount";
import { useOverflowVisibility } from "../../hooks/useOverflowVisibility";
import { useUIStore } from "../../stores/uiStore";
import {
  COST_LENS_IDS,
  type LensConfig,
  PERFORMANCE_LENS_IDS,
  useViewStore,
} from "../../stores/viewStore";
import { OverflowMenu } from "../shared/OverflowMenu";
import { CreateLensButton } from "./CreateLensButton";
import { LensNameDialog } from "./LensNameDialog";
import { LensTab } from "./LensTab";
import { UnsavedLensDialog } from "./UnsavedLensDialog";

const ERRORS_LENS_ID = "errors";

// Built-in lenses folded into dimension dropdowns instead of flat tabs, to
// keep the strip scannable. See specs/traces-v2/lens-preset-groups.feature
const LENS_GROUPS: { label: string; ids: readonly string[] }[] = [
  { label: "Cost", ids: COST_LENS_IDS },
  { label: "Performance", ids: PERFORMANCE_LENS_IDS },
];
const GROUPED_LENS_IDS: ReadonlySet<string> = new Set(
  LENS_GROUPS.flatMap((g) => [...g.ids]),
);
const isGroupedLens = (id: string): boolean => GROUPED_LENS_IDS.has(id);
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
  // Save-as-new from the unsaved-changes prompt routes through the shared
  // LensNameDialog (not window.prompt) — same name-entry UI as the lens-tab
  // menus. The unsaved dialog closes before the name dialog opens, so a
  // popover can't anchor here; a dialog is the right primitive.
  const [saveAsNewOpen, setSaveAsNewOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Grouped lenses live in their dimension dropdowns (Cost, Performance), so
  // they're pulled out of the flat tab strip (and out of overflow tracking,
  // which measures rendered tabs by data-value). See
  // specs/traces-v2/lens-preset-groups.feature
  const flatLenses = useMemo(
    () => allLenses.filter((l) => !isGroupedLens(l.id)),
    [allLenses],
  );
  // Each group's lenses in the group's declared order, dropping any the user
  // has dismissed (absent from allLenses).
  const lensGroups = useMemo(
    () =>
      LENS_GROUPS.map((g) => ({
        label: g.label,
        lenses: g.ids
          .map((id) => allLenses.find((l) => l.id === id))
          .filter((l): l is LensConfig => !!l),
      })).filter((g) => g.lenses.length > 0),
    [allLenses],
  );
  const lensIds = useMemo(() => flatLenses.map((l) => l.id), [flatLenses]);
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
      flatLenses
        .filter((l) => hiddenIds.has(l.id))
        .map((l) => ({ id: l.id, label: l.name })),
    [flatLenses, hiddenIds],
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

  // Hand off from the unsaved-changes prompt to the name dialog: close the
  // former, open the latter. The actual create happens on the dialog's
  // submit (handleSaveAsNewSubmit).
  const resolvePendingSaveAsNew = () => {
    setPendingLensId(null);
    setSaveAsNewOpen(true);
  };

  // Saving as a new lens already activates that new lens, so we drop the
  // pending switch — the user opted to keep their work, switching them away
  // afterwards would defeat the gesture.
  const handleSaveAsNewSubmit = (name: string) => {
    createLens(name);
    setSaveAsNewOpen(false);
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
                {flatLenses.map((lens) => (
                  <LensTab
                    key={lens.id}
                    lens={lens}
                    isDraft={isDraft(lens.id)}
                    errorCount={lens.id === ERRORS_LENS_ID ? errorCount : 0}
                    hidden={hiddenIds.has(lens.id)}
                  />
                ))}
              </Tabs.List>
              {/* Dimension lens groups (Cost, Performance) folded into
                  dropdowns to save strip width. */}
              {lensGroups.map((group) => (
                <LensGroupMenu
                  key={group.label}
                  label={group.label}
                  lenses={group.lenses}
                  activeLensId={activeLensId}
                  onSelect={handleLensChange}
                />
              ))}
              {/* `+` lives inside the same horizontal scroller, immediately
                  after the last tab — sits next to the lenses regardless of
                  how much room the toolbar has. */}
              <CreateLensButton />
            </HStack>
          </Box>
        </Tabs.Root>
        {/* Reset-to-saved-lens — moved here from the filter sidebar so the
            lens-draft action lives WITH the lenses, right after the tabs. Shown
            only while the active lens has unsaved local changes (and isn't the
            All baseline). Orange = the lens/draft hue used by the tab's draft
            dot, so it reads unmistakably as "revert this lens". */}
        {activeLensIsDraft && activeLensId !== "all-traces" && (
          <Tooltip
            content={
              <HStack gap={1.5}>
                <Text>Reset to saved lens</Text>
                <Kbd>R</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="2xs"
              variant="subtle"
              colorPalette="orange"
              flexShrink={0}
              marginLeft={1}
              gap={1}
              onClick={() => revertLens(activeLensId)}
              aria-label="Reset to saved lens"
            >
              <RotateCcw size={12} />
              Reset
            </Button>
          </Tooltip>
        )}
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

      <LensNameDialog
        open={saveAsNewOpen}
        onOpenChange={setSaveAsNewOpen}
        title="Save changes as new lens"
        defaultName={`${activeLens?.name ?? "Lens"} (copy)`}
        onSubmit={handleSaveAsNewSubmit}
      />
    </>
  );
};

/**
 * A dimension lens dropdown (e.g. "Cost", "Performance") standing in for a
 * group of built-in lenses. Reads as a tab — muted label, orange underline
 * when one of its lenses is active — so it sits naturally in the lens strip
 * while collapsing several entries into one slot. Items show the full lens
 * name. Renders nothing if all of the group's lenses have been dismissed.
 */
const LensGroupMenu: React.FC<{
  label: string;
  lenses: LensConfig[];
  activeLensId: string;
  onSelect: (id: string) => void;
}> = ({ label, lenses, activeLensId, onSelect }) => {
  if (lenses.length === 0) return null;
  const active = lenses.some((l) => l.id === activeLensId);
  const activeName = lenses.find((l) => l.id === activeLensId)?.name;
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button
          size="sm"
          variant="plain"
          flexShrink={0}
          // Stretch to the tab-row height so the active underline sits on the
          // same baseline as the flat tabs' line indicator (a centred,
          // fixed-height button floated its underline above theirs).
          alignSelf="stretch"
          height="auto"
          minHeight={0}
          gap={1}
          paddingX={2}
          fontSize="xs"
          fontWeight="medium"
          color={active ? "fg" : "fg.muted"}
          borderBottomWidth="2px"
          borderRadius={0}
          borderColor={active ? "orange.solid" : "transparent"}
          // The plain Button inherits colorPalette="orange" from Tabs.Root,
          // so its default focus ring rendered as a thick orange box around
          // the trigger. Replace it with the same quiet treatment the flat
          // Tabs.Trigger uses: a subtle bg tint on keyboard focus, no ring.
          _hover={{ bg: "bg.subtle" }}
          _focusVisible={{ outline: "none", bg: "bg.subtle" }}
          aria-label={
            active && activeName
              ? `${label} lenses, currently ${activeName}`
              : `${label} lenses`
          }
        >
          {label}
          <ChevronDown size={12} />
        </Button>
      </MenuTrigger>
      <MenuContent minWidth="220px">
        {lenses.map((lens) => (
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
