import { Button, type ButtonProps, Text } from "@chakra-ui/react";
import { Code2 } from "lucide-react";
import { forwardRef } from "react";

type AddLogicButtonProps = {
  onClick: (e: React.MouseEvent) => void;
} & ButtonProps;

/**
 * Button for adding template logic constructs, shown on hover in the textarea.
 */
export const AddLogicButton = forwardRef<
  HTMLButtonElement,
  AddLogicButtonProps
>(({ onClick, ...props }, ref) => {
  return (
    <Button
      ref={ref}
      size="xs"
      variant="outline"
      colorPalette="gray"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      // Solid (non-transparent) background + tight padding so the button
      // reads as its own pill over the textarea text.
      bg="bg.panel"
      borderColor="border"
      paddingX={2}
      _hover={{ background: "bg.muted" }}
      {...props}
    >
      <Text fontSize="xs" marginRight={1} fontWeight="500">
        Add logic
      </Text>
      <Code2 size={14} />
    </Button>
  );
});

AddLogicButton.displayName = "AddLogicButton";
