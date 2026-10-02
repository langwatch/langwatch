import { Drawer } from "@langwatch/design-system/drawer";
import { Button, HStack } from "@langwatch/design-system/primitives";
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
        <Drawer.Title>{isEditing ? "Edit Voice Agent" : "New Voice Agent"}</Drawer.Title>
      </HStack>
    </Drawer.Header>
  );
}
