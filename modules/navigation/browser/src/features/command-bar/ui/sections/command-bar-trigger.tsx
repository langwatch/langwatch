import { RawKbd as Kbd } from "@langwatch/design-system/kbd";
import { Button, Text } from "@langwatch/design-system/primitives";
import { Search } from "lucide-react";

import { openCommandBar } from "../../behavior/command-bar-control.ts";
import { getCommandBarShortcut } from "../../model/command-platform.ts";

/**
 * The top bar's "Search" pill with its shortcut hint. Opens the mounted palette
 * through the module-scope control, so it works outside the provider too.
 */
export function CommandBarTrigger() {
  const shortcut = getCommandBarShortcut();

  return (
    <Button
      aria-label="Open command bar"
      variant="ghost"
      borderRadius="full"
      backgroundColor="bg.input/70"
      paddingLeft={3}
      paddingRight={3}
      height="32px"
      textStyle="bodySm"
      color="fg.muted"
      fontWeight="normal"
      gap={2}
      onClick={openCommandBar}
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
