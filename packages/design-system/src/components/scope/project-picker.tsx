import { Check, ChevronsUpDown, Copy, Plus, Search } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useState } from "react";

import {
  Box,
  Button,
  Combobox,
  createListCollection,
  HStack,
  IconButton,
  Portal,
  Text,
  VisuallyHidden,
} from "../../primitives.ts";
import { COPY_FEEDBACK_MS } from "../../use-copy-to-clipboard.ts";
import { InlineCode } from "../display/inline-code.tsx";
import { AggregateProjectAvatar, ProjectAvatar } from "../display/project-avatar.tsx";
import { Tooltip } from "../overlays/tooltip.tsx";
import {
  filterProjectPickerItems,
  groupProjectPickerItems,
  type ProjectPickerGroup,
  type ProjectPickerItem,
  type ProjectPickerVisibleGroup,
  projectPickerItems,
  resolveProjectPick,
} from "./project-picker-items.ts";

export type { ProjectPickerGroup, ProjectPickerItem } from "./project-picker-items.ts";

export interface ProjectPickerProps {
  groups: ProjectPickerGroup[];
  currentProjectId: string;
  currentProjectName: string;
  currentProjectIsAggregate?: boolean;
  showTeamHeaders: boolean;
  onOpenProject: (href: string) => void;
  onCreateProjectForTeam?: ({ teamId, orgId }: { teamId: string; orgId: string }) => void;
  triggerTestId?: string;
  tourAnchor?: string;
  /** Which edge of the chip the popup lines up with; "end" for a chip at a header's right. */
  align?: "start" | "end";
}

/**
 * The one project picker: a focused search over the projects by team, the current one
 * ticked, a pointed-at or arrowed-to row showing its ID with a copy button. Holds no
 * data: the caller hands the groups. Spec: specs/navigation/one-project-picker.feature
 */
export function ProjectPicker(props: ProjectPickerProps) {
  const { groups, currentProjectId, align = "start" } = props;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null);
  // Opening highlights the current project; its ID waits until the reader moves.
  const [revealing, setRevealing] = useState(false);
  const idCopy = useProjectIdCopy();
  const { allItems, collection, visibleGroups } = projectPickerView({ groups, query });
  const highlighted = allItems.find(
    (item) => item.kind === "project" && item.value === highlightedValue,
  );
  const revealedValue = revealing ? (highlighted?.value ?? null) : null;

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (REVEALING_KEYS.has(event.key)) setRevealing(true);
    const copyKeys = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c";
    const field = event.currentTarget;
    if (!copyKeys || !highlighted || query || field.selectionStart !== field.selectionEnd) return;
    event.preventDefault();
    setRevealing(true);
    idCopy.copy({ value: highlighted.value, name: highlighted.label });
  };

  const pick = (value: string) => {
    const outcome = resolveProjectPick({ value, items: allItems, groups, currentProjectId });
    if (outcome?.kind === "create") props.onCreateProjectForTeam?.(outcome.team);
    if (outcome?.kind === "open") props.onOpenProject(outcome.href);
  };

  return (
    <Combobox.Root
      collection={collection}
      value={[currentProjectId]}
      openOnClick
      selectionBehavior="clear"
      // Typing highlights the top result, so a reader can search and press Enter
      // without the arrow keys or the mouse.
      inputBehavior="autohighlight"
      onHighlightChange={(details) => setHighlightedValue(details.highlightedValue)}
      onValueChange={(details) => {
        const next = details.value?.[0];
        if (next) pick(next);
      }}
      inputValue={query}
      onInputValueChange={(details) => setQuery(details.inputValue)}
      open={open}
      onOpenChange={(details) => {
        // The first Escape empties the field; the next one closes the menu.
        if (!details.open && details.reason === "escape-key" && query) {
          setQuery("");
          return;
        }
        setOpen(details.open);
        if (details.open) setQuery("");
        else setRevealing(false);
      }}
      // Sized by the popup, not the chip, so the viewport shift sees its whole width.
      positioning={{ placement: `bottom-${align}`, gutter: 4, sameWidth: false }}
      width="auto"
    >
      <ProjectPickerTrigger
        {...props}
        // A touch has no hover: the highlighted row shows its ID from the start.
        onPointerDown={(event) => setRevealing(event.pointerType === "touch")}
      />
      <ProjectPickerPopup
        visibleGroups={visibleGroups}
        showTeamHeaders={props.showTeamHeaders}
        currentProjectId={currentProjectId}
        query={query}
        revealedValue={revealedValue}
        onPointToRow={() => setRevealing(true)}
        onSearchKeyDown={onSearchKeyDown}
        idCopy={idCopy}
      />
    </Combobox.Root>
  );
}

/** What the popup offers for a query: every entry, the kept ones as a collection, by team. */
function projectPickerView({ groups, query }: { groups: ProjectPickerGroup[]; query: string }) {
  const allItems = projectPickerItems(groups);
  const filteredItems = filterProjectPickerItems({ items: allItems, query });
  const collection = createListCollection({
    items: filteredItems,
    itemToValue: (item) => item.value,
    itemToString: (item) => item.label,
  });
  const visibleGroups = groupProjectPickerItems({ groups, items: filteredItems });
  return { allItems, collection, visibleGroups };
}

/** The portaled popup: the search field, the empty state and the team groups. */
function ProjectPickerPopup({
  visibleGroups,
  showTeamHeaders,
  currentProjectId,
  query,
  revealedValue,
  onPointToRow,
  onSearchKeyDown,
  idCopy,
}: {
  visibleGroups: ProjectPickerVisibleGroup[];
  showTeamHeaders: boolean;
  currentProjectId: string;
  query: string;
  revealedValue: string | null;
  onPointToRow: () => void;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  idCopy: ProjectIdCopy;
}) {
  return (
    <Portal>
      <Combobox.Positioner>
        <Combobox.Content
          minWidth="260px"
          maxWidth="360px"
          maxHeight="360px"
          overflowY="auto"
          padding={0}
        >
          <ProjectSearchHeader onKeyDown={onSearchKeyDown} />
          <VisuallyHidden aria-live="polite">{copyAnnouncement(idCopy.feedback)}</VisuallyHidden>
          <Combobox.Empty paddingX={3} paddingY={2} color="fg.muted" textStyle="bodySm">
            {`No projects match "${query.trim()}"`}
          </Combobox.Empty>
          <Box padding={1}>
            {visibleGroups.map((group) => (
              <Combobox.ItemGroup key={group.team.teamId}>
                <Combobox.ItemGroupLabel
                  paddingX={2}
                  paddingTop={2}
                  paddingBottom={1}
                  color="fg.muted"
                  textStyle="groupLabel"
                >
                  {showTeamHeaders ? group.team.label : "Projects"}
                </Combobox.ItemGroupLabel>
                {group.items.map((item) => (
                  <ProjectItemRow
                    key={item.value}
                    item={item}
                    isCurrent={item.value === currentProjectId}
                    revealed={item.value === revealedValue}
                    onPointerMove={onPointToRow}
                    idCopy={idCopy}
                  />
                ))}
              </Combobox.ItemGroup>
            ))}
          </Box>
        </Combobox.Content>
      </Combobox.Positioner>
    </Portal>
  );
}

/** The chip that opens the popup; a long name truncates, named in full on hover. */
function ProjectPickerTrigger({
  currentProjectName,
  currentProjectIsAggregate = false,
  triggerTestId,
  tourAnchor,
  onPointerDown,
}: Pick<
  ProjectPickerProps,
  "currentProjectName" | "currentProjectIsAggregate" | "triggerTestId" | "tourAnchor"
> & { onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void }) {
  return (
    // Ark positions the listbox against the CONTROL, so the trigger must live
    // inside one that generates a layout box.
    <Combobox.Control display="inline-flex" width="auto" minWidth={0}>
      <Combobox.Trigger asChild>
        <Button
          variant="ghost"
          aria-label="Switch project"
          data-testid={triggerTestId}
          data-tour={tourAnchor}
          onPointerDown={onPointerDown}
          textStyle="bodySm"
          fontWeight="normal"
          paddingX={2}
          height="32px"
          color="fg"
          gap={2}
          minWidth={0}
          maxWidth="260px"
          _hover={{ backgroundColor: "bg.muted" }}
        >
          {currentProjectIsAggregate ? (
            <AggregateProjectAvatar name={currentProjectName} />
          ) : (
            <ProjectAvatar name={currentProjectName} />
          )}
          <Text truncate minWidth={0} title={currentProjectName}>
            {currentProjectName}
          </Text>
          <ChevronsUpDown
            size={12}
            color="var(--chakra-colors-fg-muted)"
            style={{ flexShrink: 0 }}
          />
        </Button>
      </Combobox.Trigger>
    </Combobox.Control>
  );
}

/** The focused search field pinned to the top of the popup. */
function ProjectSearchHeader({
  onKeyDown,
}: {
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <Box
      position="sticky"
      top={0}
      zIndex={1}
      background="bg.panel"
      paddingX={2.5}
      paddingY={1.5}
      borderBottomWidth="1px"
      borderColor="border"
    >
      <HStack gap={2} color="fg.muted">
        <Search size={14} aria-hidden />
        <Combobox.Input
          aria-label="Search projects"
          aria-keyshortcuts="Control+C Meta+C"
          onKeyDown={onKeyDown}
          placeholder="Search projects"
          height="28px"
          minWidth={0}
          flex={1}
          padding={0}
          border={0}
          outline="none"
          background="transparent"
          textStyle="bodySm"
          color="fg"
          _placeholder={{ color: "fg.subtle" }}
          _focusVisible={{ outline: "none" }}
        />
      </HStack>
    </Box>
  );
}

function ProjectItemIcon({ item }: { item: ProjectPickerItem }) {
  if (item.kind === "new-project") return <Plus size={13} aria-hidden />;
  if (item.isAggregate) return <AggregateProjectAvatar name={item.label} />;
  return <ProjectAvatar name={item.label} />;
}

function ProjectItemRow({
  item,
  isCurrent,
  revealed,
  onPointerMove,
  idCopy,
}: {
  item: ProjectPickerItem;
  isCurrent: boolean;
  revealed: boolean;
  onPointerMove: () => void;
  idCopy: ProjectIdCopy;
}) {
  const showsId = revealed && item.kind === "project";
  return (
    <Combobox.Item item={item} onPointerMove={onPointerMove}>
      <HStack gap={2} width="full">
        <ProjectItemIcon item={item} />
        {/* The ID overlays the row's end, so it never widens the popup; the name gives way. */}
        <Box position="relative" flex={1} minWidth={0} display="flex" alignItems="center">
          <Combobox.ItemText truncate maxWidth={showsId ? `calc(100% - ${ID_SLOT})` : "full"}>
            {item.label}
          </Combobox.ItemText>
          {showsId ? (
            <ProjectIdWithCopy projectId={item.value} projectName={item.label} idCopy={idCopy} />
          ) : (
            isCurrent && (
              <Box marginInlineStart="auto" display="flex" flexShrink={0}>
                <Check size={13} aria-label="Current project" />
              </Box>
            )
          )}
        </Box>
      </HStack>
    </Combobox.Item>
  );
}

/** What the trailing ID slot may take of a row: the shortened ID plus its copy button. */
const ID_SLOT = "11rem";

/** Keys that move the highlight, after which the highlighted row shows its ID. */
const REVEALING_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"]);

/**
 * A row's project ID, cut in the middle (full value in the title), and a copy button.
 * The button keeps the search field focused and never reaches the row, so copying
 * neither switches project nor closes the picker.
 */
function ProjectIdWithCopy({
  projectId,
  projectName,
  idCopy,
}: {
  projectId: string;
  projectName: string;
  idCopy: ProjectIdCopy;
}) {
  const feedback = idCopy.feedback?.value === projectId ? idCopy.feedback : null;
  const [hovered, setHovered] = useState(false);
  return (
    <HStack
      position="absolute"
      insetEnd={0}
      gap={1}
      maxWidth={ID_SLOT}
      justifyContent="flex-end"
      data-testid="project-picker-id"
    >
      <InlineCode variant="neutral" truncate="middle" tail={6} selectOnClick={false}>
        {projectId}
      </InlineCode>
      <Tooltip
        open={hovered || feedback !== null}
        onOpenChange={(details) => setHovered(details.open)}
        content={copyTooltip(feedback)}
        positioning={{ placement: "right" }}
      >
        <IconButton
          type="button"
          size="2xs"
          variant="ghost"
          flexShrink={0}
          color={feedback?.outcome === "copied" ? "fg.success" : "fg.muted"}
          aria-label={`Copy the ID of ${projectName}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            idCopy.copy({ value: projectId, name: projectName });
          }}
        >
          {feedback?.outcome === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
        </IconButton>
      </Tooltip>
    </HStack>
  );
}

function copyTooltip(feedback: CopyFeedback | null): string {
  if (!feedback) return "Copy project ID";
  return feedback.outcome === "copied" ? "Copied" : "Couldn't copy the ID";
}

interface CopyFeedback {
  value: string;
  name: string;
  outcome: "copied" | "failed";
}

interface ProjectIdCopy {
  feedback: CopyFeedback | null;
  copy: (target: { value: string; name: string }) => void;
}

/** Copies a project ID and holds the outcome briefly; a refused clipboard is a "failed". */
function useProjectIdCopy(): ProjectIdCopy {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  const copy = ({ value, name }: { value: string; name: string }) => {
    const write = navigator.clipboard
      ? navigator.clipboard.writeText(value)
      : Promise.reject(new Error("clipboard unavailable"));
    void write.then(
      () => setFeedback({ value, name, outcome: "copied" }),
      () => setFeedback({ value, name, outcome: "failed" }),
    );
  };
  return { feedback, copy };
}

function copyAnnouncement(feedback: CopyFeedback | null): string {
  if (!feedback) return "";
  return feedback.outcome === "copied"
    ? `Copied the ID of ${feedback.name}`
    : `Couldn't copy the ID of ${feedback.name}; your browser blocked the clipboard`;
}
