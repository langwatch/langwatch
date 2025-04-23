import { Button, Spinner } from "@chakra-ui/react";
import { Save } from "lucide-react";

export function VersionSaveButton({
  saveEnabled,
  onSaveClick,
  isSaving,
}: {
  saveEnabled?: boolean;
  onSaveClick: () => void;
  isSaving?: boolean;
}) {
  return (
    <Button
      type="submit"
      disabled={!!isSaving || !saveEnabled}
      colorPalette="green"
      loading={isSaving}
      onClick={(e) => {
        e.preventDefault();
        onSaveClick();
      }}
    >
      {isSaving ? <Spinner /> : <Save />}
      Save Version
    </Button>
  );
}
