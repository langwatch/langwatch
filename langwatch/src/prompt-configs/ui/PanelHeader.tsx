import { Button, Heading, HStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import { Columns } from "react-feather";

// Component for the panel header
interface PanelHeaderProps {
  title: React.ReactNode;
  onClose?: () => void;
  showExpandButton?: boolean;
  onExpand?: () => void;
}

export function PanelHeader({
  title,
  onClose,
  showExpandButton = false,
  onExpand,
}: PanelHeaderProps) {
  return (
    <HStack
      width="full"
      justify="space-between"
      gap={0}
      alignItems="flex-start"
      marginBottom={8}
    >
      <HStack gap={2}>
        <PanelTitle title={title} />
      </HStack>
      <PanelActions
        onClose={onClose}
        onExpand={onExpand}
        showExpandButton={showExpandButton}
      />
    </HStack>
  );
}

// Component for displaying the panel title/name
interface PanelTitleProps {
  title: React.ReactNode;
  isEditing?: boolean;
  value?: string;
  onEdit?: () => void;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

function PanelTitle({ title }: PanelTitleProps) {
  return (
    <Heading
      lineClamp={2}
      fontWeight={500}
      cursor="pointer"
      overflow="hidden"
      textOverflow="ellipsis"
    >
      {title}
    </Heading>
  );
}

// Component for the panel header actions
interface PanelActionsProps {
  onExpand?: () => void;
  onClose?: () => void;
  showExpandButton?: boolean;
}

function PanelActions({ onExpand, onClose }: PanelActionsProps) {
  return (
    <HStack gap={0}>
      <Button variant="ghost" size="sm" color="gray.500" onClick={onExpand}>
        <Columns size={16} />
      </Button>
      <Button variant="ghost" size="sm" color="gray.500" onClick={onClose}>
        <X size={16} />
      </Button>
    </HStack>
  );
}
