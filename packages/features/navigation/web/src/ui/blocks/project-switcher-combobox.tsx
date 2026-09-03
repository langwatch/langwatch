import { Button, Combobox, Text } from "@chakra-ui/react";
import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useNavigationHost } from "../../model/navigation-host";
import {
  type ProjectPickGroup,
  resolvePickOutcome,
  useProjectPickItems,
} from "../../model/project-pick-items";
import { ProjectAvatar } from "../elements/project-avatar";
import { ProjectComboboxPopup } from "./project-switcher-combobox-popup";

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
  const host = useNavigationHost();
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
    if (outcome?.kind === "open") host.navigate(outcome.href);
  };

  return (
    <Combobox.Root
      collection={collection}
      value={[currentProjectId]}
      openOnClick
      selectionBehavior="clear"
      // Typing highlights the top result, so a reader can search and press
      // Enter without reaching for the arrow keys or the mouse. A running
      // search offers projects only, so Enter can never land on a create
      // entry (see `useProjectPickItems`).
      inputBehavior="autohighlight"
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
      <ProjectComboboxTrigger currentProjectName={currentProjectName} />
      <ProjectComboboxPopup
        visibleGroups={visibleGroups}
        showTeamHeaders={showTeamHeaders}
        currentProjectId={currentProjectId}
      />
    </Combobox.Root>
  );
}

/** The chip that opens the popup, styled the same as the plain menu's. */
function ProjectComboboxTrigger({ currentProjectName }: { currentProjectName: string }) {
  return (
    // Ark positions the listbox against the CONTROL, so the trigger
    // must live inside one that generates a layout box.
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
  );
}
