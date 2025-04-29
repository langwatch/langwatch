import { Button, Spinner, Text } from "@chakra-ui/react";
import { Save } from "lucide-react";
import { Tooltip } from "../../../../components/ui/tooltip";

export function VersionSaveButton({
  disabled,
  onClick,
  isSaving,
}: {
  disabled?: boolean;
  onClick: () => void;
  isSaving?: boolean;
}) {
  return (
    <Tooltip
      content="Save prompt version"
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
        <Text display={{ base: "none", "2xl": "block" }}>Save Version</Text>
      </Button>
    </Tooltip>
  );
}
