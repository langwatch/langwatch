/**
 * SaveAsViewButton -- button at the bottom of FilterSidebar that allows
 * saving the current filter state as a named custom view.
 *
 * Only visible when ClickHouse data source is enabled for the project.
 * The inner component is split out so useSavedViews() is only called
 * when SavedViewsProvider is guaranteed to be present.
 */

import { Button, HStack, Input, VStack } from "@chakra-ui/react";
import React, { useCallback, useRef, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { MAX_VIEW_NAME_LENGTH, useSavedViews } from "../../hooks/useSavedViews";

export function SaveAsViewButton() {
  const { project } = useOrganizationTeamProject();
  const hasClickHouse = project?.featureClickHouseDataSourceTraces === true;

  if (!hasClickHouse) return null;

  return <SaveAsViewButtonContent />;
}

function SaveAsViewButtonContent() {
  const { saveView } = useSavedViews();
  const [isNaming, setIsNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSaveClick = useCallback(() => {
    setIsNaming(true);
    setViewName("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleConfirm = useCallback(() => {
    const trimmed = viewName.trim();
    if (!trimmed) {
      setIsNaming(false);
      return;
    }
    saveView(trimmed);
    setIsNaming(false);
    setViewName("");
  }, [viewName, saveView]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleConfirm();
      } else if (e.key === "Escape") {
        setIsNaming(false);
        setViewName("");
      }
    },
    [handleConfirm],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (containerRef.current?.contains(e.relatedTarget as Node | null)) {
        return;
      }
      handleConfirm();
    },
    [handleConfirm],
  );

  if (isNaming) {
    return (
      <VStack ref={containerRef} width="full" gap={2} onBlur={handleBlur}>
        <Input
          ref={inputRef}
          size="sm"
          placeholder="View name..."
          value={viewName}
          onChange={(e) =>
            setViewName(e.target.value.slice(0, MAX_VIEW_NAME_LENGTH))
          }
          onKeyDown={handleKeyDown}
          data-testid="save-view-name-input"
        />
        <HStack width="full" gap={2}>
          <Button
            size="sm"
            variant="subtle"
            width="full"
            onClick={() => {
              setIsNaming(false);
              setViewName("");
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            colorPalette="blue"
            width="full"
            onClick={handleConfirm}
            disabled={!viewName.trim()}
          >
            Save
          </Button>
        </HStack>
      </VStack>
    );
  }

  return (
    <Button
      colorPalette="blue"
      size="sm"
      alignSelf="flex-end"
      onClick={handleSaveClick}
      data-testid="save-as-view-button"
    >
      Save as view
    </Button>
  );
}
