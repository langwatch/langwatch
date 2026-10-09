import { Box, chakra, VStack } from "@langwatch/design-system/primitives";
import type { InsightFolder } from "@langwatch/insight-contract";
import { Archive, Clock3, Inbox, type LucideIcon } from "lucide-react";

const FOLDERS: readonly { id: InsightFolder; label: string; icon: LucideIcon }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "stale", label: "Stale", icon: Clock3 },
  { id: "archived", label: "Archived", icon: Archive },
];

export type FolderCount = { count: number; hot: boolean };

/** Inbox, Stale, Archived: each with its count, an accent pill while something is unread. */
export function FolderRail({
  active,
  counts,
  onSelect,
}: {
  active: InsightFolder;
  counts: Record<InsightFolder, FolderCount>;
  onSelect: (folder: InsightFolder) => void;
}) {
  return (
    <VStack
      as="nav"
      aria-label="Insight folders"
      align="stretch"
      gap={0.5}
      width="168px"
      flexShrink={0}
    >
      {FOLDERS.map(({ id, label, icon: Icon }) => {
        const { count, hot } = counts[id];
        const isActive = id === active;
        return (
          <chakra.button
            key={id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect(id)}
            display="flex"
            alignItems="center"
            gap={2.5}
            width="full"
            borderRadius="lg"
            paddingX={2.5}
            paddingY="5px"
            fontSize="13px"
            fontWeight={isActive ? "medium" : "normal"}
            color={isActive ? "fg" : "fg.muted"}
            background={isActive ? "bg.emphasized" : "transparent"}
            cursor="pointer"
            _hover={{ background: isActive ? "bg.emphasized" : "bg.muted", color: "fg" }}
          >
            <Icon size={15} strokeWidth={1.9} aria-hidden />
            {label}
            {count > 0 && (
              <Box
                as="span"
                marginLeft="auto"
                fontSize="10.5px"
                fontVariantNumeric="tabular-nums"
                {...(hot
                  ? {
                      borderRadius: "full",
                      paddingX: "6px",
                      fontWeight: "semibold",
                      color: "accent.contrast",
                      background: "accent.solid",
                    }
                  : { color: "fg.subtle" })}
              >
                {count}
              </Box>
            )}
          </chakra.button>
        );
      })}
    </VStack>
  );
}
