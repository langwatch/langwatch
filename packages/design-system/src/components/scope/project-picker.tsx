import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { useState } from "react";

import {
  Box,
  Button,
  Combobox,
  createListCollection,
  HStack,
  Portal,
  Text,
} from "../../primitives.ts";
import { AggregateProjectAvatar, ProjectAvatar } from "../display/project-avatar.tsx";
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
 * The one project picker: a chip opening a focused search over the projects by team,
 * the current one ticked, Enter picking the first match. Holds no data: the caller
 * hands the groups and follows the pick. Spec: specs/navigation/one-project-picker.feature
 */
export function ProjectPicker(props: ProjectPickerProps) {
  const { groups, currentProjectId, align = "start" } = props;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { allItems, collection, visibleGroups } = projectPickerView({ groups, query });

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
      }}
      // Sized by the popup, not the chip, so the viewport shift sees its whole width.
      positioning={{ placement: `bottom-${align}`, gutter: 4, sameWidth: false }}
      width="auto"
    >
      <ProjectPickerTrigger {...props} />
      <ProjectPickerPopup
        visibleGroups={visibleGroups}
        showTeamHeaders={props.showTeamHeaders}
        currentProjectId={currentProjectId}
        query={query}
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
}: {
  visibleGroups: ProjectPickerVisibleGroup[];
  showTeamHeaders: boolean;
  currentProjectId: string;
  query: string;
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
          <ProjectSearchHeader />
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
}: Pick<
  ProjectPickerProps,
  "currentProjectName" | "currentProjectIsAggregate" | "triggerTestId" | "tourAnchor"
>) {
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
function ProjectSearchHeader() {
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

function ProjectItemRow({ item, isCurrent }: { item: ProjectPickerItem; isCurrent: boolean }) {
  return (
    <Combobox.Item item={item}>
      <HStack gap={2} width="full">
        <ProjectItemIcon item={item} />
        <Combobox.ItemText flex={1} truncate>
          {item.label}
        </Combobox.ItemText>
        {isCurrent && <Check size={13} aria-label="Current project" />}
      </HStack>
    </Combobox.Item>
  );
}
