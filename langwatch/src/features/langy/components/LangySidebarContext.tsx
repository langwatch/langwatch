import {
  Box,
  chakra,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ClipboardCheck,
  Database,
  FileText,
  Filter,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  MessagesSquare,
  Plus,
  Waypoints,
  X,
} from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import { LangyContextChipHover } from "./LangyContextChipHover";
import type { LangyContextChip } from "../stores/langyStore";

/**
 * The docked sidebar's context panel — what Langy is looking at, shown loud.
 *
 * The floating card hides context behind a compact "Context" summary button (it
 * has to; it floats over the page and must stay small). The dock has the room,
 * and its whole promise is "I'm working alongside you", so here the context is
 * ALWAYS-VISIBLE: one chip per thing Langy holds, named for a human, each with a
 * remove affordance. Trace chips lead with a name and keep the id in the hover
 * (see LangyContextChipHover). Nothing to show → the panel renders nothing
 * rather than an empty frame.
 *
 * Two sources sit side by side and read identically:
 *   - `entries` the user is already working from — derived from the route / open
 *     drawer / table state, or explicitly attached by a surface (a home card).
 *   - `addableChips` they removed and can add back.
 */
const CONTEXT_ICON: Record<LangyContextChip["kind"], LucideIcon> = {
  project: FolderKanban,
  experiment: FlaskConical,
  trace: Waypoints,
  prompt: FileText,
  dataset: Database,
  dashboard: LayoutDashboard,
  scenario: MessagesSquare,
  evaluation: ClipboardCheck,
  selection: ListChecks,
  filter: Filter,
};

export interface SidebarContextEntry {
  chip: LangyContextChip;
  /** Where the chip came from — decides which removal path fires. */
  source: "page" | "attached";
}

export function LangySidebarContext({
  entries,
  addableChips,
  onRemovePage,
  onDetach,
  onAdd,
}: {
  entries: SidebarContextEntry[];
  addableChips: LangyContextChip[];
  /** Remove a route/drawer-derived chip — dismiss it for this conversation. */
  onRemovePage: (id: string) => void;
  /** Remove a surface-attached item — detach it by its ref. */
  onDetach: (ref: string) => void;
  /** Add a previously-removed chip back. */
  onAdd: (id: string) => void;
}) {
  if (entries.length === 0 && addableChips.length === 0) return null;

  return (
    <VStack
      align="stretch"
      gap={2}
      paddingX="14px"
      paddingTop="12px"
      paddingBottom="12px"
      flexShrink={0}
    >
      <HStack gap={1.5} color="fg.muted">
        <Waypoints size={12} />
        <Text
          textStyle="2xs"
          fontWeight="semibold"
          textTransform="uppercase"
          letterSpacing="0.05em"
        >
          In context
        </Text>
      </HStack>

      {entries.length > 0 ? (
        <Box display="flex" flexWrap="wrap" gap="6px">
          {entries.map(({ chip, source }) => (
            <ContextChipCard
              key={chip.id}
              chip={chip}
              onRemove={() =>
                source === "attached"
                  ? onDetach(chip.ref ?? chip.id)
                  : onRemovePage(chip.id)
              }
            />
          ))}
        </Box>
      ) : (
        <Text textStyle="2xs" color="fg.subtle">
          Langy is working from this project. Add something specific below.
        </Text>
      )}

      {addableChips.length > 0 ? (
        <Box display="flex" flexWrap="wrap" gap="6px">
          {addableChips.map((chip) => {
            const Icon = CONTEXT_ICON[chip.kind] ?? Waypoints;
            return (
              <chakra.button
                key={chip.id}
                type="button"
                onClick={() => onAdd(chip.id)}
                aria-label={`Add ${chip.label} to context`}
                display="inline-flex"
                alignItems="center"
                gap={1}
                maxWidth="100%"
                paddingX={2}
                paddingY={1}
                borderRadius="md"
                borderWidth="1px"
                borderStyle="dashed"
                borderColor="border.muted"
                background="transparent"
                color="fg.subtle"
                cursor="pointer"
                transition="color 120ms ease, border-color 120ms ease"
                _hover={{ color: "fg", borderColor: "border.emphasized" }}
              >
                <Plus size={11} />
                <Icon size={12} />
                <Text textStyle="2xs" truncate>
                  {chip.label}
                </Text>
              </chakra.button>
            );
          })}
        </Box>
      ) : null}
    </VStack>
  );
}

/** One always-visible context chip: icon, human label, and a remove X. */
function ContextChipCard({
  chip,
  onRemove,
}: {
  chip: LangyContextChip;
  onRemove: () => void;
}) {
  const Icon = CONTEXT_ICON[chip.kind] ?? Waypoints;

  return (
    <LangyContextChipHover chip={chip}>
      <HStack
        gap={1.5}
        maxWidth="100%"
        paddingLeft={2}
        paddingRight={1}
        paddingY={1}
        borderRadius="md"
        borderWidth="1px"
        borderStyle="solid"
        borderColor="border.muted"
        background="bg.muted/55"
      >
        <Box
          color="orange.fg"
          display="grid"
          placeItems="center"
          flexShrink={0}
        >
          <Icon size={12} />
        </Box>
        <Text textStyle="2xs" fontWeight="medium" color="fg" truncate>
          {chip.label}
        </Text>
        <Tooltip
          content="Remove from context"
          positioning={{ placement: "top" }}
        >
          <IconButton
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            aria-label={`Remove ${chip.label} from context`}
            flexShrink={0}
            minWidth="18px"
            height="18px"
            _hover={{ color: "fg" }}
            onClick={(event) => {
              // The chip is wrapped in a hover tooltip; stop the click from
              // bubbling into anything that might treat the chip as a target.
              event.stopPropagation();
              onRemove();
            }}
          >
            <X size={11} />
          </IconButton>
        </Tooltip>
      </HStack>
    </LangyContextChipHover>
  );
}
