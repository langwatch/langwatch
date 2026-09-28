import { Box, chakra, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ArrowUp, Copy, MoreVertical, RefreshCw, Trash2 } from "react-feather";

import { WorkflowIcon } from "./workflow-icons.tsx";

type WorkflowCardBaseProps = Omit<React.ComponentProps<typeof VStack>, "onClick"> & {
  /** Opens the card, from a full-card button stacked beneath the card's own controls. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  /** What the opener is called; the card's name by default. */
  label?: string;
  /** Opens the card some other way, e.g. a `WorkflowCardLink`, instead of the button. */
  opener?: React.ReactNode;
};

/** The whole-card target: stretched over the card, beneath its controls, reachable by keyboard. */
const OPENER_STYLE = {
  position: "absolute",
  inset: 0,
  zIndex: 1,
  borderRadius: "xl",
  cursor: "pointer",
  _focusVisible: { outline: "2px solid", outlineColor: "blue.focusRing" },
} as const;

/** A card opener that navigates rather than acts. */
export function WorkflowCardLink({
  label,
  ...props
}: { label: string } & Omit<React.ComponentProps<typeof Link>, "children">) {
  return <Link aria-label={label} {...OPENER_STYLE} {...props} />;
}

export function WorkflowCardBase({
  onClick,
  label,
  opener,
  children,
  ...props
}: WorkflowCardBaseProps) {
  return (
    <VStack
      align="start"
      position="relative"
      padding={4}
      gap={2}
      borderRadius="xl"
      background="bg.panel"
      boxShadow="md"
      height="142px"
      transition="all 0.2s ease-in-out"
      border="1px solid"
      borderColor="border.muted"
      _hover={{
        boxShadow: "xl",
        textDecoration: "none",
      }}
      {...props}
    >
      {opener ??
        (onClick && (
          <chakra.button type="button" aria-label={label} onClick={onClick} {...OPENER_STYLE} />
        ))}
      {children}
    </VStack>
  );
}

export function WorkflowCardDisplay({
  name,
  icon,
  description,
  updatedAtLabel,
  action,
  children,
  ...props
}: {
  name: string;
  icon: React.ReactNode;
  description?: string;
  updatedAtLabel?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
} & WorkflowCardBaseProps) {
  return (
    <WorkflowCardBase paddingX={0} label={name} {...props}>
      <HStack gap={4} paddingX={4} paddingBottom={2} width="full">
        <WorkflowIcon icon={icon} size="lg" />
        {description && (
          <Text color="fg" fontSize="sm" fontWeight={500}>
            {name}
          </Text>
        )}
        <Spacer />
        <Box position="relative" zIndex={2}>
          {action}
        </Box>
      </HStack>
      {children}
      {!description && <Spacer />}
      <Text paddingX={4} color="fg" fontSize="sm" fontWeight={!description ? 500 : undefined}>
        {description ?? name}
      </Text>
      <Text paddingX={4} color="fg.subtle" fontSize="12px">
        {updatedAtLabel}
      </Text>
    </WorkflowCardBase>
  );
}

export function WorkflowCardActions({
  isCopy,
  hasCopies,
  sourceProjectPath,
  onSyncFromSource,
  onPushToCopies,
  onCopy,
  onDelete,
}: {
  isCopy: boolean;
  hasCopies: boolean;
  sourceProjectPath?: string;
  onSyncFromSource: () => void;
  onPushToCopies: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className="js-inner-menu" aria-label="Workflow actions">
        <MoreVertical size={16} />
      </Menu.Trigger>
      <Menu.Content className="js-inner-menu">
        {isCopy && (
          <Tooltip
            content={sourceProjectPath ? `Copied from: ${sourceProjectPath}` : undefined}
            disabled={!sourceProjectPath}
            positioning={{ placement: "right" }}
            showArrow
          >
            <Menu.Item value="sync" onClick={onSyncFromSource}>
              <RefreshCw size={16} /> Update from source
            </Menu.Item>
          </Tooltip>
        )}
        {hasCopies && (
          <Menu.Item value="push" onClick={onPushToCopies}>
            <ArrowUp size={16} /> Push to replicas
          </Menu.Item>
        )}
        <Menu.Item value="copy" onClick={onCopy}>
          <Copy size={16} /> Replicate to another project
        </Menu.Item>
        <Menu.Item value="delete" color="red.500" onClick={onDelete}>
          <Trash2 size={16} /> Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
