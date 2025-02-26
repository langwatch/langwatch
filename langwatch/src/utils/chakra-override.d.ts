// Re-export everything from Chakra UI except Dialog
import type * as Chakra from "@chakra-ui/internal";

type ChakraWithoutDialog = Omit<typeof Chakra, "Dialog">;

// For the value exports (components, hooks, etc.)
declare const chakraWithoutDialog: ChakraWithoutDialog;

// For the type exports
declare module "@chakra-ui/react" {
  // Re-export all types from the internal module
  export type {
    AvatarRootProps,
    BoxProps,
    ButtonProps,
    InputProps,
    MenuItemProps,
    StackProps,
    SystemStyleObject,
    TextProps,
    // Add other prop types you need
  } from "@chakra-ui/internal";

  // Export the value without Dialog
  export = chakraWithoutDialog;
}
