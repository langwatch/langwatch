/**
 * SaveAsViewButton -- button at the bottom of FilterSidebar that allows
 * saving the current filter state as a named custom view.
 *
 * Only visible when ClickHouse data source is enabled for the project.
 * The inner component is split out so useSavedViews() is only called
 * when SavedViewsProvider is guaranteed to be present.
 */

import { Button, HStack, Input } from "@chakra-ui/react";
import { useRouter } from "next/router";
import React, { useCallback, useRef, useState } from "react";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { MAX_VIEW_NAME_LENGTH, useSavedViews } from "../../hooks/useSavedViews";
import { Dialog } from "../ui/dialog";

export function SaveAsViewButton() {
  const { project } = useOrganizationTeamProject();
  const hasClickHouse = project?.featureClickHouseDataSourceTraces === true;

  if (!hasClickHouse) return null;

  return <SaveAsViewButtonContent />;
}

function SaveAsViewButtonContent() {
  const { saveView } = useSavedViews();
  const { hasAnyFilters } = useFilterParams();
  const router = useRouter();
  const hasQuery = !!router.query.query;
  const hasDateParams = !!router.query.startDate || !!router.query.endDate;
  const hasAnythingToSave = hasAnyFilters || hasQuery || hasDateParams;
  const [isOpen, setIsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    setViewName("");
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleConfirm = useCallback(() => {
    const trimmed = viewName.trim();
    if (!trimmed) return;
    saveView(trimmed);
    setIsOpen(false);
    setViewName("");
  }, [viewName, saveView]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleConfirm();
      }
    },
    [handleConfirm],
  );

  return (
    <>
      <Button
        colorPalette="blue"
        size="sm"
        alignSelf="flex-end"
        onClick={handleOpen}
        disabled={!hasAnythingToSave}
        data-testid="save-as-view-button"
      >
        Save as view
      </Button>

      <Dialog.Root
        open={isOpen}
        onOpenChange={(e) => setIsOpen(e.open)}
        size="sm"
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Save as view</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Input
              ref={inputRef}
              placeholder="View name..."
              value={viewName}
              onChange={(e) =>
                setViewName(e.target.value.slice(0, MAX_VIEW_NAME_LENGTH))
              }
              onKeyDown={handleKeyDown}
              data-testid="save-view-name-input"
            />
          </Dialog.Body>
          <Dialog.Footer>
            <HStack gap={2}>
              <Button
                variant="ghost"
                onClick={() => {
                  setIsOpen(false);
                  setViewName("");
                }}
              >
                Cancel
              </Button>
              <Button
                colorPalette="blue"
                onClick={handleConfirm}
                disabled={!viewName.trim()}
              >
                Save
              </Button>
            </HStack>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
