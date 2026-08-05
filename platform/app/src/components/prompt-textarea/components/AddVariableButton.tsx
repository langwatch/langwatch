import { Button, type ButtonProps, Text } from "@chakra-ui/react";
import { Braces } from "lucide-react";
import { forwardRef } from "react";

type AddVariableButtonProps = {
  onClick: (e: React.MouseEvent) => void;
} & ButtonProps;

/**
 * Button for adding variables, shown on hover in the textarea.
 */
export const AddVariableButton = forwardRef<
  HTMLButtonElement,
  AddVariableButtonProps
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
        Add variable
      </Text>
      <Braces size={14} />
    </Button>
  );
});

AddVariableButton.displayName = "AddVariableButton";
