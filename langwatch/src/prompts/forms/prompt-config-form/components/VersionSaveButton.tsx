import { Button, Text } from "@chakra-ui/react";
import { Save } from "lucide-react";
import { Tooltip } from "../../../../components/ui/tooltip";

/**
 * Version Save Button
 * Single Responsibility: Renders a save button that reflects and controls the save state of the current prompt version.
 * @param disabled - Whether the button is disabled
 * @param onClick - The function to call when the button is clicked
 * @param hideLabel - Whether to hide the label
 * @returns A Button component that saves the current prompt version
 */
export function VersionSaveButton({
  disabled,
  onClick,
  hideLabel = false,
}: {
  disabled?: boolean;
  onClick: () => void;
  hideLabel?: boolean;
}) {
  return (
    <Tooltip
      content={disabled ? "No changes detected" : ""}
      positioning={{ placement: "top" }}
      openDelay={0}
      showArrow
    >
      <Button
        type="submit"
        data-testid="save-version-button"
        disabled={!!disabled}
        colorPalette="green"
        onClick={(e) => {
          e.preventDefault();
          onClick();
        }}
      >
        <Save />
        {!hideLabel && <Text>Save Version</Text>}
      </Button>
    </Tooltip>
  );
}
