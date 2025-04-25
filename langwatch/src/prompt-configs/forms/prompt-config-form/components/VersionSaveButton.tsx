import { Button, Spinner, Text } from "@chakra-ui/react";
import { Save } from "lucide-react";

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
    <Button
      type="submit"
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
  );
}
