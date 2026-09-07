import {
  Badge,
  chakra,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Archive, Bell, Clock, Inbox, Mail } from "lucide-react";

/**
 * The inbox's folder rail: what Langy filed, what went stale, what was put
 * away, and the two streams that ride on top. Every count is zero until
 * there is a job to fill them, and the rail says zero rather than hiding
 * the numbers: an empty inbox with its folders in place reads as an inbox,
 * not as a page that forgot its navigation.
 *
 * Same grammar as the annotations rail (AnnotationsLayout): 12.5px rows,
 * the selected row on `bg.muted`, the count in the trailing slot. Folders
 * are page state, not routes, because nothing lives behind them yet.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
export type InsightsFolder =
  | "inbox"
  | "stale"
  | "archived"
  | "alerts"
  | "notifications";

export type InsightsRailCounts = Record<InsightsFolder, number>;

export const EMPTY_INSIGHTS_COUNTS: InsightsRailCounts = {
  inbox: 0,
  stale: 0,
  archived: 0,
  alerts: 0,
  notifications: 0,
};

/** What each folder says when it is empty; the inbox has its own card. */
export const EMPTY_FOLDER_LINE: Record<
  Exclude<InsightsFolder, "inbox">,
  string
> = {
  stale:
    "Nothing has gone stale. Insights land here when their validity runs out.",
  archived: "Nothing archived. Insights you put away keep their evidence here.",
  alerts: "No alerts. Signals that trip land here, on top of the brief.",
  notifications:
    "No notifications. Mentions and hand-offs from Langy land here.",
};

const FOLDERS: Array<{
  id: InsightsFolder;
  label: string;
  icon: typeof Inbox;
  /** Streams wear a badge; folders a quiet number. */
  stream: boolean;
}> = [
  { id: "inbox", label: "Inbox", icon: Inbox, stream: false },
  { id: "stale", label: "Stale", icon: Clock, stream: false },
  { id: "archived", label: "Archived", icon: Archive, stream: false },
  { id: "alerts", label: "Alerts", icon: Bell, stream: true },
  { id: "notifications", label: "Notifications", icon: Mail, stream: true },
];

export function InsightsRail({
  selected,
  counts,
  onSelect,
}: {
  selected: InsightsFolder;
  counts: InsightsRailCounts;
  onSelect: (folder: InsightsFolder) => void;
}) {
  return (
    <VStack
      as="nav"
      aria-label="Insights folders"
      align="stretch"
      gap={0.5}
      minWidth="200px"
      fontSize="12.5px"
      flexShrink={0}
    >
      {FOLDERS.map((folder, index) => {
        const active = folder.id === selected;
        const count = counts[folder.id];
        const Icon = folder.icon;
        return (
          <VStack key={folder.id} align="stretch" gap={0.5}>
            {/* The streams sit under a rule: they are not folders of the
                brief, they ride on top of it. */}
            {index > 0 && folder.stream && !FOLDERS[index - 1]?.stream ? (
              <Separator marginY={1.5} />
            ) : null}
            <chakra.button
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(folder.id)}
              display="flex"
              alignItems="center"
              gap={2.5}
              width="full"
              paddingX="10px"
              paddingY="6px"
              borderRadius="lg"
              textAlign="left"
              fontWeight={active ? "medium" : "normal"}
              color={active ? "fg" : "fg.muted"}
              background={active ? "bg.muted" : "transparent"}
              cursor="pointer"
              _hover={{ background: "bg.muted/60" }}
            >
              <Icon size={15} />
              <Text flex={1}>{folder.label}</Text>
              <HStack gap={0} aria-label={`${folder.label} count`}>
                {folder.stream ? (
                  <Badge
                    size="sm"
                    borderRadius="full"
                    variant={count > 0 ? "solid" : "subtle"}
                    colorPalette={count > 0 ? "orange" : "gray"}
                    minWidth="22px"
                    justifyContent="center"
                  >
                    {count}
                  </Badge>
                ) : (
                  <Text fontSize="10.5px" fontWeight="500" color="fg.subtle">
                    {count}
                  </Text>
                )}
              </HStack>
            </chakra.button>
          </VStack>
        );
      })}
    </VStack>
  );
}
