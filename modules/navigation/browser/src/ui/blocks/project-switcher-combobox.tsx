import { Button, Combobox, Text } from "@langwatch/design-system/primitives";
import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { useNavigationHost } from "../../model/navigation-host.ts";
import {
  type ProjectPickGroup,
  resolvePickOutcome,
  useProjectPickItems,
} from "../../model/project-pick-items.ts";
import { AggregateProjectAvatar, ProjectAvatar } from "../elements/project-avatar.tsx";
import { ProjectComboboxPopup } from "./project-switcher-combobox-popup.tsx";

/**
 * Project switch combobox: searchable, grouped by team,
 * keyboard navigation. Spec: modules/navigation/specs/product-switcher-navigation.feature
 */
export function ProjectSwitcherCombobox({
  groups,
  currentProjectId,
  currentProjectName,
  currentProjectIsAggregate = false,
  showTeamHeaders,
  onCreateProjectForTeam,
}: {
  groups: ProjectPickGroup[];
  currentProjectId: string;
  currentProjectName: string;
  currentProjectIsAggregate?: boolean;
  showTeamHeaders: boolean;
  onCreateProjectForTeam:
    | (({ teamId, orgId }: { teamId: string; orgId: string }) => void)
    | undefined;
}) {
  const host = useNavigationHost();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
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
      positioning={{ placement: "bottom-start", gutter: 4 }}
      width="auto"
    >
      <ProjectComboboxTrigger
        currentProjectName={currentProjectName}
        currentProjectIsAggregate={currentProjectIsAggregate}
      />
      <ProjectComboboxPopup
        visibleGroups={visibleGroups}
        showTeamHeaders={showTeamHeaders}
        currentProjectId={currentProjectId}
        query={query}
      />
    </Combobox.Root>
  );
}

/** The chip that opens the popup, styled the same as the plain menu's. */
function ProjectComboboxTrigger({
  currentProjectName,
  currentProjectIsAggregate,
}: {
  currentProjectName: string;
  currentProjectIsAggregate: boolean;
}) {
  return (
    // Ark positions the listbox against the CONTROL, so the trigger
    // must live inside one that generates a layout box.
    <Combobox.Control display="inline-flex" width="auto" minWidth={0}>
      <Combobox.Trigger asChild>
        <Button
          variant="ghost"
          aria-label="Switch project"
          data-testid="navigation-project-switcher"
          data-tour="project-switcher"
          textStyle="bodySm"
          fontWeight="normal"
          paddingX={2}
          height="32px"
          color="fg"
          gap={2}
          _hover={{ backgroundColor: "bg.muted" }}
        >
          {currentProjectIsAggregate ? (
            <AggregateProjectAvatar name={currentProjectName} />
          ) : (
            <ProjectAvatar name={currentProjectName} />
          )}
          <Text whiteSpace="nowrap">{currentProjectName}</Text>
          <ChevronsUpDown size={12} color="var(--chakra-colors-fg-muted)" />
        </Button>
      </Combobox.Trigger>
    </Combobox.Control>
  );
}
