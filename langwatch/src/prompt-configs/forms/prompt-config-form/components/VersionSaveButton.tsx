import { Button, Spinner, Text } from "@chakra-ui/react";
import { Save } from "lucide-react";
import { Tooltip } from "../../../../components/ui/tooltip";

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
