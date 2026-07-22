import { Button, Kbd, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { useCommandBar } from "./CommandBarContext";
import { getCommandBarShortcut } from "./utils/platform";

/**
 * Button to trigger opening the command bar.
 * Shows a search icon, "Search" text, and keyboard shortcut hint.
 */
export function CommandBarTrigger() {
  const { open } = useCommandBar();
  const shortcut = getCommandBarShortcut();

  return (
    <Button
      aria-label="Open command bar"
      variant="ghost"
      // Same 28px/rounded-md language as the workspace chip so the header
      // controls read as one family.
      // Spec: specs/navigation/shell-visual-language.feature
      borderRadius="md"
      backgroundColor="bg.input/50"
      border="1px solid"
      borderColor="border.muted"
      paddingLeft={2.5}
      paddingRight={2}
      height="28px"
      fontSize="13px"
      color="fg.muted"
      fontWeight="normal"
      gap={2}
      onClick={open}
      _hover={{ backgroundColor: "bg.inputHover", borderColor: "border" }}
    >
      <Search size={14} aria-hidden />
      <Text display={{ base: "none", md: "block" }}>Search</Text>
      <Kbd size="sm" display={{ base: "none", md: "block" }}>
        {shortcut}
      </Kbd>
    </Button>
  );
}
