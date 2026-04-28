import { Box, Button, HStack, Tabs } from "@chakra-ui/react";
import { startTransition, useEffect, useRef, useState } from "react";
import type React from "react";
import { MoreHorizontal } from "lucide-react";
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
  const saveLens = useViewStore((s) => s.saveLens);
  const revertLens = useViewStore((s) => s.revertLens);
  const isDraft = useViewStore((s) => s.isDraft);
  const errorCount = useErrorCount();

  const [pendingLensId, setPendingLensId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hiddenIds = useHiddenLensTabs(scrollerRef, allLenses);

  const activeLens = allLenses.find((l) => l.id === activeLensId);
  const activeLensIsDraft = isDraft(activeLensId);
  const hiddenLenses = allLenses.filter((l) => hiddenIds.has(l.id));

  const handleLensChange = (targetId: string) => {
    if (targetId === activeLensId) return;
    if (activeLens && !activeLens.isBuiltIn && activeLensIsDraft) {
      setPendingLensId(targetId);
      return;
    }
    startTransition(() => selectLens(targetId));
  };

  const resolvePending = (resolve: (lensId: string) => void) => {
    resolve(activeLensId);
    if (pendingLensId) {
      const target = pendingLensId;
      startTransition(() => selectLens(target));
    }
    setPendingLensId(null);
  };

  const handleOverflowSelect = (id: string) => {
    handleLensChange(id);
    const root = scrollerRef.current;
    if (!root) return;
    const tab = root.querySelector<HTMLElement>(`[data-value="${id}"]`);
    tab?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  };

  return (
    <>
      <HStack gap={0} flex="1" minWidth={0}>
        <Tabs.Root
          value={activeLensId}
          onValueChange={(e) => handleLensChange(e.value)}
          variant="line"
          size="sm"
          colorPalette="blue"
          borderBottomWidth={0}
          marginBottom="-2px"
          flex="1"
          minWidth={0}
        >
          <Box
            ref={scrollerRef}
            overflowX="auto"
            css={{
              scrollbarWidth: "none",
              "&::-webkit-scrollbar": { display: "none" },
            }}
          >
            <Tabs.List borderBottomWidth={0} flexWrap="nowrap" width="max-content">
              {allLenses.map((lens) => (
                <LensTab
                  key={lens.id}
                  lens={lens}
                  isDraft={isDraft(lens.id)}
                  errorCount={lens.id === ERRORS_LENS_ID ? errorCount : 0}
                />
              ))}
            </Tabs.List>
          </Box>
        </Tabs.Root>
        <OverflowMenu
          hiddenLenses={hiddenLenses}
          activeLensId={activeLensId}
          onSelect={handleOverflowSelect}
        />
        <CreateLensButton />
      </HStack>

      <UnsavedLensDialog
        open={pendingLensId !== null}
        lensName={activeLens?.name ?? ""}
        onSave={() => resolvePending(saveLens)}
        onDiscard={() => resolvePending(revertLens)}
        onCancel={() => setPendingLensId(null)}
      />
    </>
  );
};

function useHiddenLensTabs(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  allLenses: LensConfig[],
): Set<string> {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const tabs = root.querySelectorAll<HTMLElement>("[data-value]");
    if (tabs.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setHiddenIds((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const id = entry.target.getAttribute("data-value");
            if (!id) continue;
            const fullyVisible = entry.intersectionRatio >= 0.99;
            if (fullyVisible && next.has(id)) {
              next.delete(id);
              changed = true;
            } else if (!fullyVisible && !next.has(id)) {
              next.add(id);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root, threshold: [0, 0.99, 1] },
    );

    tabs.forEach((tab) => observer.observe(tab));
    return () => observer.disconnect();
  }, [allLenses, scrollerRef]);

  return hiddenIds;
}

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
          paddingX={1}
          minWidth="auto"
          aria-label={`Show ${hiddenLenses.length} more lenses`}
        >
          <MoreHorizontal />
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
