import { Box, VStack, HStack, Text } from "@chakra-ui/react";
import { ChevronDown } from "react-feather";
import { useState } from "react";

interface SidebarRootProps {
  children: React.ReactNode;
}

function SidebarRoot({ children }: SidebarRootProps) {
  return (
    <Box
      as="nav"
      width="280px"
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
      bg="white"
    >
      {children}
    </Box>
  );
}

interface SidebarSectionProps {
  title: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}

function SidebarSection({
  title,
  collapsible = false,
  defaultOpen = true,
  action,
  children,
}: SidebarSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <VStack gap={0} align="stretch">
      <Box
        padding="3"
        fontSize="sm"
        fontWeight="medium"
        color="gray.700"
        bg="white"
        borderBottom="1px solid"
        borderColor="gray.100"
        cursor={collapsible ? "pointer" : "default"}
        onClick={collapsible ? () => setIsOpen(!isOpen) : undefined}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        _hover={{ bg: "gray.50" }}
      >
        <HStack gap={2}>
          {collapsible && (
            <Box
              transform={isOpen ? "rotate(0deg)" : "rotate(-90deg)"}
              transition="transform 0.2s"
            >
              <ChevronDown size={14} />
            </Box>
          )}
          <Text>{title}</Text>
        </HStack>
        {action && <Box onClick={(e) => e.stopPropagation()}>{action}</Box>}
      </Box>
      {(!collapsible || isOpen) && (
        <Box padding="0" bg="white">
          {children}
        </Box>
      )}
    </VStack>
  );
}

interface SidebarListProps {
  children: React.ReactNode;
}

function SidebarList({ children }: SidebarListProps) {
  return (
    <VStack gap={1} align="stretch">
      {children}
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
          width="20px"
          height="20px"
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
  Section: SidebarSection,
  List: SidebarList,
  Item: SidebarItem,
};
