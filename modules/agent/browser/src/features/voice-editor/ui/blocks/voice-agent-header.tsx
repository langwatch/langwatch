import { Button, Heading, HStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { ArrowLeft } from "lucide-react";

export function VoiceAgentHeader({
  canGoBack,
  onGoBack,
  isEditing,
}: {
  canGoBack: boolean;
  onGoBack: () => void;
  isEditing: boolean;
}) {
  return (
    <Drawer.Header>
      <HStack gap={2}>
        {canGoBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onGoBack}
            padding={1}
            minWidth="auto"
            data-testid="back-button"
          >
            <ArrowLeft size={20} />
          </Button>
        )}
        <Heading>{isEditing ? "Edit Voice Agent" : "New Voice Agent"}</Heading>
      </HStack>
    </Drawer.Header>
  );
}
