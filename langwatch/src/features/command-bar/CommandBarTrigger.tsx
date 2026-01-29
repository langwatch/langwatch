import { Button, HStack, Kbd, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { useCommandBar } from "./CommandBarContext";

/**
 * Button to trigger opening the command bar.
 * Shows a search icon, "Search" text, and keyboard shortcut hint.
 */
export function CommandBarTrigger() {
  const { open } = useCommandBar();

  // Detect platform for keyboard hint
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcut = isMac ? "⌘K" : "Ctrl+K";

  return (
    <Button
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
      <Search size={14} />
      <Text display={{ base: "none", md: "block" }}>Search</Text>
      <Kbd size="sm" display={{ base: "none", md: "block" }}>
        {shortcut}
      </Kbd>
    </Button>
  );
}
