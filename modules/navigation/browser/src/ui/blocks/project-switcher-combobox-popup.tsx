import { Box, Combobox, HStack, Portal } from "@langwatch/design-system/primitives";
import { AggregateProjectAvatar, ProjectAvatar } from "@langwatch/design-system/project-avatar";
import { Check, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";

import type { ProjectPickGroup, ProjectPickItem } from "../../model/project-pick-items.ts";

/**
 * The portaled popup of the project switcher combobox: an optional header,
 * the search field, the empty state and the team groups.
 */
export function ProjectComboboxPopup({
  visibleGroups,
  showTeamHeaders,
  currentProjectId,
  query,
  header,
}: {
  visibleGroups: {
    team: ProjectPickGroup["team"];
    items: ProjectPickItem[];
  }[];
  showTeamHeaders: boolean;
  currentProjectId: string;
  query: string;
  header?: ReactNode;
}) {
  return (
    <Portal>
      <Combobox.Positioner>
        <Combobox.Content
          minWidth="260px"
          maxHeight="min(480px, 70vh)"
          overflowY="auto"
          padding={0}
        >
          <Box
            ref={padScrollUnderPinned}
            position="sticky"
            top={0}
            zIndex={1}
            background="bg.panel"
          >
            {header}
            <ProjectSearchHeader />
          </Box>
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

/** Keeps a keyboard-highlighted row from scrolling under the pinned header and search. */
function padScrollUnderPinned(pinned: HTMLDivElement | null) {
  const content = pinned?.parentElement;
  if (!pinned || !content) return;
  const sync = () => content.style.setProperty("scroll-padding-top", `${pinned.offsetHeight}px`);
  sync();
  const observer = new ResizeObserver(sync);
  observer.observe(pinned);
  return () => observer.disconnect();
}

/** The focused search field, pinned to the top of the popup with the header. */
function ProjectSearchHeader() {
  return (
    <Box paddingX={2.5} paddingY={1.5} borderBottomWidth="1px" borderColor="border">
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

function ProjectItemIcon({ item }: { item: ProjectPickItem }) {
  if (item.kind === "new-project") return <Plus size={13} aria-hidden />;
  if (item.isAggregate) return <AggregateProjectAvatar name={item.label} />;
  return <ProjectAvatar name={item.label} />;
}

function ProjectItemRow({ item, isCurrent }: { item: ProjectPickItem; isCurrent: boolean }) {
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
