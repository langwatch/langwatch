import { Button, Spinner, Text } from "@chakra-ui/react";
import { Save } from "lucide-react";
import { Tooltip } from "../../../../components/ui/tooltip";

export function VersionSaveButton({
  disabled,
  onClick,
  isSaving,
  hideLabel = false,
}: {
  disabled?: boolean;
  onClick: () => void;
  isSaving?: boolean;
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
        disabled={!!isSaving || !!disabled}
        colorPalette="green"
        loading={isSaving}
        onClick={(e) => {
          e.preventDefault();
          onClick();
        }}
      >
        {isSaving ? <Spinner /> : <Save />}
        {!hideLabel && <Text>Save Version</Text>}
      </Button>
    </Tooltip>
  );
}
