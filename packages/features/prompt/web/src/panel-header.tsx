import { Button, Heading, HStack, type StackProps } from "@chakra-ui/react";
import { Columns, X } from "lucide-react";
import type { ReactNode } from "react";

interface PanelHeaderProps extends Omit<StackProps, "title"> { title: ReactNode; onClose?: () => void; showExpandButton?: boolean; onExpand?: () => void }

export function PanelHeader({ title, onClose, showExpandButton = false, onExpand, ...props }: PanelHeaderProps) {
  return <HStack width="full" justify="space-between" gap={0} alignItems="flex-start" {...props}><HStack gap={2}><Heading lineClamp={2} fontWeight={500} overflow="hidden" textOverflow="ellipsis">{title}</Heading></HStack><HStack gap={0}>{showExpandButton && <Button variant="ghost" size="sm" color="fg.muted" onClick={onExpand}><Columns size={16} /></Button>}<Button variant="ghost" size="sm" color="fg.muted" onClick={onClose}><X size={16} /></Button></HStack></HStack>;
}
