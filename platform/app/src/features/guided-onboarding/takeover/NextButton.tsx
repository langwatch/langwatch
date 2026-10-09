import { Button } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";

/**
 * The takeover's Next: left-aligned under the words, hidden until the screen
 * says so, and then fading in over half a second.
 */
export function NextButton({
  show,
  onClick,
}: {
  show: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      mt={8}
      onClick={onClick}
      data-testid="takeover-next"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      size="md"
      h="42px"
      px={6}
      borderRadius="full"
      bg="fg"
      color="bg.panel"
      fontWeight="600"
      fontSize="14px"
      gap={1}
      _hover={{ opacity: 0.9 }}
      transition="all 0.5s ease"
      opacity={show ? 1 : 0}
      transform={show ? "translateY(0)" : "translateY(8px)"}
      pointerEvents={show ? "auto" : "none"}
    >
      Next
      <ChevronRight size={16} />
    </Button>
  );
}
