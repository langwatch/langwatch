import { Box, Combobox, HStack, Portal } from "@chakra-ui/react";
import { Check, Plus, Search } from "lucide-react";
import type { ProjectPickGroup, ProjectPickItem } from "../../model/project-pick-items";
import { ProjectAvatar } from "../elements/project-avatar";

/**
 * The portaled popup of the project switcher combobox: the search field,
 * the empty state and the team groups.
 */
export function ProjectComboboxPopup({
  visibleGroups,
  showTeamHeaders,
  currentProjectId,
}: {
  visibleGroups: Array<{
    team: ProjectPickGroup["team"];
    items: ProjectPickItem[];
  }>;
  showTeamHeaders: boolean;
  currentProjectId: string;
}) {
  return (
    <Portal>
      <Combobox.Positioner>
        <Combobox.Content minWidth="260px" maxHeight="360px" overflowY="auto" padding={0}>
          <ProjectSearchHeader />
          <Combobox.Empty paddingX={3} paddingY={2} color="fg.muted" fontSize="13px">
            No projects match your search.
          </Combobox.Empty>
          <Box padding={1}>
            {visibleGroups.map((group) => (
              <Combobox.ItemGroup key={group.team.teamId}>
                <Combobox.ItemGroupLabel
                  paddingX={2}
                  paddingTop={2}
                  paddingBottom={1}
                  color="fg.muted"
                  fontSize="11px"
                  fontWeight="600"
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
          autoFocus
          aria-label="Search projects"
          placeholder="Search projects"
          height="28px"
          minWidth={0}
          flex={1}
          padding={0}
          border={0}
          outline="none"
          background="transparent"
          fontSize="13px"
          color="fg"
          _placeholder={{ color: "fg.subtle" }}
          _focusVisible={{ outline: "none" }}
        />
      </HStack>
    </Box>
  );
}

function ProjectItemRow({
  item,
  isCurrent,
}: {
  item: ProjectPickItem;
  isCurrent: boolean;
}) {
  return (
    <Combobox.Item
      item={item}
      borderRadius="md"
      paddingX={2}
      paddingY={1.5}
      fontSize="13px"
      _highlighted={{ background: "bg.subtle" }}
    >
      <HStack gap={2} width="full">
        {item.kind === "new-project" ? (
          <Plus size={13} aria-hidden />
        ) : (
          <ProjectAvatar name={item.label} />
        )}
        <Combobox.ItemText flex={1} truncate>
          {item.label}
        </Combobox.ItemText>
        {isCurrent && <Check size={13} aria-label="Current project" />}
      </HStack>
    </Combobox.Item>
  );
}
