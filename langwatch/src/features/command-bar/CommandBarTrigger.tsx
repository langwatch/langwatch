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
      borderRadius="full"
      backgroundColor="bg.input"
      paddingLeft={3}
      paddingRight={3}
      height="32px"
      fontSize="13px"
      color="fg.muted"
      fontWeight="normal"
      gap={2}
      onClick={open}
      _hover={{ backgroundColor: "bg.inputHover" }}
    >
      <Search size={14} aria-hidden />
      <Text display={{ base: "none", md: "block" }}>Search</Text>
      <Kbd size="sm" display={{ base: "none", md: "block" }}>
        {shortcut}
      </Kbd>
    </Button>
  );
}
