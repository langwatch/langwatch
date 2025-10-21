import { Box, VStack, HStack, Text, type BoxProps } from "@chakra-ui/react";
import { ChevronDown } from "react-feather";
import { useState } from "react";

interface SidebarRootProps {
  children: React.ReactNode;
}

function SidebarRoot({ children }: SidebarRootProps) {
  return (
    <Box
      as="nav"
      width="380px"
      minWidth="300px"
      height="100%"
      bg="gray.50"
      borderRight="1px solid"
      borderColor="gray.200"
      overflowY="auto"
    >
      <VStack gap={0} align="stretch">
        {children}
      </VStack>
    </Box>
  );
}

interface SidebarHeaderProps {
  children: React.ReactNode;
}

function SidebarHeader({ children }: SidebarHeaderProps) {
  return (
    <Box
      padding="4"
      fontSize="lg"
      fontWeight="semibold"
      borderBottom="1px solid"
      borderColor="gray.200"
    >
      {children}
    </Box>
  );
}

type SidebarSectionHeaderProps = BoxProps;

function SidebarSectionHeader({ children }: SidebarSectionHeaderProps) {
  return (
    <Box
      padding="3"
      fontSize="sm"
      fontWeight="medium"
      color="gray.700"
      borderBottom="1px solid"
      borderColor="gray.100"
      display="flex"
      alignItems="center"
      justifyContent="space-between"
    >
      {children}
    </Box>
  );
}

type SidebarSectionProps = BoxProps;

function SidebarSection({ children }: SidebarSectionProps) {
  return <Box>{children}</Box>;
}

interface SidebarListProps {
  children: React.ReactNode;
  title?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}

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
      <VStack gap={1} align="stretch" paddingLeft={2}>
        {children}
      </VStack>
    );
  }

  return (
    <VStack gap={0} align="stretch">
      <SidebarSectionHeader>
        <HStack gap={2}>
          {collapsible && (
            <Box
              transform={isOpen ? "rotate(0deg)" : "rotate(-90deg)"}
              transition="transform 0.2s"
              cursor="pointer"
              onClick={() => setIsOpen(!isOpen)}
            >
              <ChevronDown size={14} />
            </Box>
          )}
          <Text>{title}</Text>
        </HStack>
        {action && <Box onClick={(e) => e.stopPropagation()}>{action}</Box>}
      </SidebarSectionHeader>
      {(!collapsible || isOpen) && (
        <VStack gap={1} align="stretch" paddingLeft={5}>
          {children}
        </VStack>
      )}
    </VStack>
  );
}

interface SidebarItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  icon?: React.ReactNode;
  meta?: string;
  variant?: "default" | "empty";
}

function SidebarItem({
  children,
  onClick,
  active = false,
  icon,
  meta,
  variant = "default",
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
      padding="2"
      fontSize="sm"
      color={active ? "blue.600" : "gray.700"}
      bg={active ? "blue.50" : "transparent"}
      borderRadius="md"
      cursor="pointer"
      _hover={{ bg: active ? "blue.50" : "gray.50" }}
      onClick={onClick}
      display="flex"
      alignItems="center"
      gap={2}
    >
      {icon && (
        <Box
          width="16px"
          height="16px"
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
        <Text
          fontSize="sm"
          fontWeight="normal"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
        >
          {children}
        </Text>
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

export const Sidebar = {
  Root: SidebarRoot,
  Header: SidebarHeader,
  SectionHeader: SidebarSectionHeader,
  List: SidebarList,
  Item: SidebarItem,
  Section: SidebarSection,
};
