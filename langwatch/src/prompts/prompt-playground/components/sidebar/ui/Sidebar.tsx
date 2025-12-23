import { Box, type BoxProps, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";

/**
 * Props for the SidebarRoot component
 */
interface SidebarRootProps {
  /** The content to render inside the sidebar */
  children: React.ReactNode;
}

/**
 * Root container for the sidebar navigation
 *
 * @param props - The component props
 * @returns A styled navigation container with vertical scrolling
 */
function SidebarRoot({ children }: SidebarRootProps) {
  return (
    <Box
      as="nav"
      width="full"
      height="100%"
      borderRight="1px solid"
      borderColor="gray.200"
      overflowY="auto"
      paddingY="2"
    >
      <VStack gap={0} align="stretch">
        {children}
      </VStack>
    </Box>
  );
}

/**
 * Props for the SidebarHeader component
 */
interface SidebarHeaderProps {
  /** The content to render in the header */
  children: React.ReactNode;
}

/**
 * Header section for the sidebar with prominent styling
 *
 * @param props - The component props
 * @returns A styled header with large, semibold text
 */
function SidebarHeader({ children }: SidebarHeaderProps) {
  return (
    <Box padding="4" fontSize="lg" fontWeight="semibold">
      {children}
    </Box>
  );
}

/**
 * Props for the SidebarSectionHeader component, extending BoxProps for additional styling
 */
type SidebarSectionHeaderProps = BoxProps;

/**
 * Header for a section within the sidebar
 *
 * @param props - The component props including children and any Box props
 * @returns A styled section header with medium weight text
 */
function SidebarSectionHeader({
  children,
  ...props
}: SidebarSectionHeaderProps) {
  return (
    <Box
      paddingX="3"
      paddingY="2"
      fontSize="sm"
      fontWeight="medium"
      color="gray.700"
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      {...props}
    >
      {children}
    </Box>
  );
}

/**
 * Props for the SidebarSection component, extending BoxProps for additional styling
 */
type SidebarSectionProps = BoxProps;

/**
 * Generic section container for grouping sidebar content
 *
 * @param props - The component props including children
 * @returns A basic Box container for section content
 */
function SidebarSection({ children }: SidebarSectionProps) {
  return <Box>{children}</Box>;
}

/**
 * Props for the SidebarList component
 */
interface SidebarListProps {
  /** The list items to render */
  children: React.ReactNode;
  /** Optional title for the list section */
  title?: string;
  /** Whether the list can be collapsed/expanded */
  collapsible?: boolean;
  /** Whether the list is open by default when collapsible */
  defaultOpen?: boolean;
  /** Optional action element (e.g., button) to display in the header */
  action?: React.ReactNode;
}

/**
 * List container with optional collapsible functionality and section header
 *
 * @param props - The component props
 * @returns A vertical stack of list items with optional collapsible header
 */
function SidebarList({
  children,
  title,
  collapsible = false,
  defaultOpen = false,
  action,
}: SidebarListProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (!title) {
    return (
      <VStack gap={0.5} align="stretch" paddingX={2}>
        {children}
      </VStack>
    );
  }

  return (
    <VStack gap={0} align="stretch">
      <SidebarSectionHeader onClick={() => setIsOpen(!isOpen)} cursor="pointer">
        <HStack gap={2}>
          {collapsible && (
            <Box
              transform={isOpen ? "rotate(0deg)" : "rotate(-90deg)"}
              transition="transform 0.2s"
            >
              <LuChevronDown size={14} />
            </Box>
          )}
          <Text>{title}</Text>
        </HStack>
        {action && <Box onClick={(e) => e.stopPropagation()}>{action}</Box>}
      </SidebarSectionHeader>
      {(!collapsible || isOpen) && (
        <VStack gap={0} align="stretch" paddingX={4}>
          {children}
        </VStack>
      )}
    </VStack>
  );
}

/**
 * Props for the SidebarItem component
 */
interface SidebarItemProps extends BoxProps {
  /** The content to render inside the item */
  children: React.ReactNode;
  /** Click handler for the item */
  onClick?: () => void;
  /** Whether the item is currently active/selected */
  active?: boolean;
  /** Optional icon to display before the content */
  icon?: React.ReactNode;
  /** Optional metadata text to display below the main content */
  meta?: string;
  /** Visual variant of the item */
  variant?: "default" | "empty";
}

/**
 * Individual item within a sidebar list with support for icons, metadata, and active states
 *
 * @param props - The component props
 * @returns A clickable item with optional icon, content, and metadata
 */
function SidebarItem({
  children,
  onClick,
  active = false,
  icon,
  meta,
  variant = "default",
  ...props
}: SidebarItemProps) {
  if (variant === "empty") {
    return (
      <Box padding="3" fontSize="sm" color="gray.500" textAlign="center">
        {children}
      </Box>
    );
  }

  return (
    <Box
      fontSize="sm"
      color={active ? "blue.600" : "gray.700"}
      bg={active ? "blue.50" : "transparent"}
      borderRadius="md"
      cursor="pointer"
      _hover={{ bg: active ? "blue.100" : "gray.100" }}
      onClick={onClick}
      display="flex"
      alignItems="center"
      gap={2}
      width="full"
      {...props}
    >
      {icon && (
        <Box
          width="16px"
          borderRadius="full"
          bg="gray.100"
          display="flex"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          {icon}
        </Box>
      )}
      <Box flex={1} minWidth={0}>
        {children}
        {meta && (
          <Text
            fontSize="xs"
            color="gray.500"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            {meta}
          </Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * Compound component for building sidebar navigation interfaces
 *
 * @example
 * ```tsx
 * <Sidebar.Root>
 *   <Sidebar.Header>My App</Sidebar.Header>
 *   <Sidebar.List title="Navigation" collapsible>
 *     <Sidebar.Item active icon={<HomeIcon />}>Home</Sidebar.Item>
 *     <Sidebar.Item onClick={() => navigate('/settings')}>Settings</Sidebar.Item>
 *   </Sidebar.List>
 * </Sidebar.Root>
 * ```
 */
export const Sidebar = {
  Root: SidebarRoot,
  Header: SidebarHeader,
  SectionHeader: SidebarSectionHeader,
  List: SidebarList,
  Item: SidebarItem,
  Section: SidebarSection,
};
