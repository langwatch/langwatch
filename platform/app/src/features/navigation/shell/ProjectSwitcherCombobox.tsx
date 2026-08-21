import {
  Box,
  Button,
  Combobox,
  createListCollection,
  HStack,
  Portal,
  Text,
} from "@chakra-ui/react";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ProjectAvatar } from "~/components/ProjectAvatar";
import { useRouter } from "~/utils/compat/next-router";

/**
 * A team and the projects the picker offers under it. The same shape
 * `ProjectScopeMenu` builds for the plain menu, so the two render paths
 * cannot drift on what they offer.
 */
export interface ProjectPickGroup {
  team: {
    teamId: string;
    orgId: string;
    label: string;
    canCreateProject?: boolean;
  };
  projects: Array<{
    projectId: string;
    label: string;
    href: string;
  }>;
}

interface ProjectPickItem {
  value: string;
  label: string;
  teamId: string;
  href: string | null;
  /** What the filter matches against: the team name plus the project name. */
  searchText: string;
  kind: "project" | "new-project";
}

function toPickItems(groups: ProjectPickGroup[]): ProjectPickItem[] {
  return groups.flatMap((group) => [
    ...group.projects.map((project) => ({
      value: project.projectId,
      label: project.label,
      teamId: group.team.teamId,
      href: project.href,
      searchText: `${group.team.label} ${project.label}`.toLowerCase(),
      kind: "project" as const,
    })),
    ...(group.team.canCreateProject
      ? [
          {
            value: `new-project:${group.team.teamId}`,
            label: "New Project",
            teamId: group.team.teamId,
            href: null,
            searchText: "",
            kind: "new-project" as const,
          },
        ]
      : []),
  ]);
}

/**
 * The items the popup offers for a query, grouped for rendering and flat
 * for the collection the keyboard walks. A running search hides the
 * create entries: they match no project, and a list of results is not
 * the place to start a different action from.
 */
function useProjectPickItems({
  groups,
  query,
}: {
  groups: ProjectPickGroup[];
  query: string;
}) {
  const allItems = useMemo(() => toPickItems(groups), [groups]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allItems;
    return allItems.filter(
      (item) => item.kind === "project" && item.searchText.includes(needle),
    );
  }, [allItems, query]);

  const collection = useMemo(
    () =>
      createListCollection({
        items: filteredItems,
        itemToValue: (item) => item.value,
        itemToString: (item) => item.label,
      }),
    [filteredItems],
  );

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          team: group.team,
          items: filteredItems.filter(
            (item) => item.teamId === group.team.teamId,
          ),
        }))
        .filter((group) => group.items.length > 0),
    [groups, filteredItems],
  );

  return { allItems, collection, visibleGroups };
}

/**
 * The project switch chip for an organization with a long project list:
 * a combobox whose popup opens with a focused search field, filters by
 * project and team name as the user types, and answers the arrow keys
 * and Enter. Grouped by team, with the per-team create entry kept while
 * the list is unfiltered.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */
export function ProjectSwitcherCombobox({
  groups,
  currentProjectId,
  currentProjectName,
  showTeamHeaders,
  onCreateProjectForTeam,
}: {
  groups: ProjectPickGroup[];
  currentProjectId: string;
  currentProjectName: string;
  showTeamHeaders: boolean;
  onCreateProjectForTeam:
    | (({ teamId, orgId }: { teamId: string; orgId: string }) => void)
    | undefined;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { allItems, collection, visibleGroups } = useProjectPickItems({
    groups,
    query,
  });

  const pick = (value: string) => {
    const outcome = resolvePickOutcome({
      value,
      allItems,
      groups,
      currentProjectId,
    });
    if (outcome?.kind === "create") onCreateProjectForTeam?.(outcome.team);
    if (outcome?.kind === "open") void router.push(outcome.href);
  };

  return (
    <Combobox.Root
      collection={collection}
      value={[currentProjectId]}
      openOnClick
      selectionBehavior="clear"
      onValueChange={(details) => {
        const next = details.value?.[0];
        if (next) pick(next);
      }}
      onInputValueChange={(details) => setQuery(details.inputValue)}
      onOpenChange={(details) => {
        if (details.open) setQuery("");
      }}
      positioning={{ placement: "bottom-start", gutter: 4 }}
      width="auto"
    >
      {/* Ark positions the listbox against the CONTROL, so the trigger
          must live inside one that generates a layout box. */}
      <Combobox.Control display="inline-flex" width="auto" minWidth={0}>
        <Combobox.Trigger asChild>
          <Button
            variant="ghost"
            aria-label="Switch project"
            fontSize="13px"
            fontWeight="normal"
            paddingX={2}
            height="32px"
            color="fg"
            gap={2}
            _hover={{ backgroundColor: "bg.muted" }}
          >
            <ProjectAvatar name={currentProjectName} />
            <Text whiteSpace="nowrap">{currentProjectName}</Text>
            <ChevronsUpDown size={12} color="var(--chakra-colors-fg-muted)" />
          </Button>
        </Combobox.Trigger>
      </Combobox.Control>
      <ProjectComboboxPopup
        visibleGroups={visibleGroups}
        showTeamHeaders={showTeamHeaders}
        currentProjectId={currentProjectId}
      />
    </Combobox.Root>
  );
}

/**
 * What picking a value means: opening a project, starting the create
 * flow for a team, or nothing (the current project, or a value that
 * left the list between render and pick).
 */
function resolvePickOutcome({
  value,
  allItems,
  groups,
  currentProjectId,
}: {
  value: string;
  allItems: ProjectPickItem[];
  groups: ProjectPickGroup[];
  currentProjectId: string;
}):
  | { kind: "create"; team: { teamId: string; orgId: string } }
  | { kind: "open"; href: string }
  | null {
  const item = allItems.find((candidate) => candidate.value === value);
  if (!item) return null;
  if (item.kind === "new-project") {
    const team = groups.find((g) => g.team.teamId === item.teamId)?.team;
    return team
      ? { kind: "create", team: { teamId: team.teamId, orgId: team.orgId } }
      : null;
  }
  if (item.value === currentProjectId || !item.href) return null;
  return { kind: "open", href: item.href };
}

/** The portaled popup: the search field, the empty state and the groups. */
function ProjectComboboxPopup({
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
        <Combobox.Content
          minWidth="260px"
          maxHeight="360px"
          overflowY="auto"
          padding={0}
        >
          <ProjectSearchHeader />
          <Combobox.Empty
            paddingX={3}
            paddingY={2}
            color="fg.muted"
            fontSize="13px"
          >
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
