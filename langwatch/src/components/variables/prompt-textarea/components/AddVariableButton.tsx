import { Button, Text } from "@chakra-ui/react";
import { Braces } from "lucide-react";
import { forwardRef } from "react";

type AddVariableButtonProps = {
  onClick: (e: React.MouseEvent) => void;
};

/**
 * Button for adding variables, shown on hover in the textarea.
 */
export const AddVariableButton = forwardRef<HTMLButtonElement, AddVariableButtonProps>(
  ({ onClick }, ref) => {
    return (
      <Button
        ref={ref}
        position="absolute"
        bottom={2.5}
        right={2}
        size="xs"
        variant="ghost"
        colorPalette="gray"
        onClick={onClick}
        onMouseDown={(e) => e.stopPropagation()}
        opacity={0.7}
        _hover={{ opacity: 1, background: "gray.100" }}
      >
        <Text fontSize="xs" marginRight={1} fontWeight="500">
          Add variable
        </Text>
        <Braces size={14} />
      </Button>
    );
  },
);

AddVariableButton.displayName = "AddVariableButton";

