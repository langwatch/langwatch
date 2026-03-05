import { Box, VStack, Text, Link as ChakraLink } from "@chakra-ui/react";
import { Link, useLocation } from "react-router-dom";

const navItems = [
  { path: "/", label: "Dashboard", exact: true },
  { path: "/stats", label: "Stats", exact: false },
  { path: "/queues", label: "Queues", exact: false },
  { path: "/errors", label: "Error Inspector", exact: false },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <Box
      w="220px"
      minH="100vh"
      bg="#0a0e17"
      borderRight="1px solid"
      borderColor="rgba(0, 240, 255, 0.15)"
      py={6}
      px={4}
      backgroundImage="linear-gradient(rgba(0, 240, 255, 0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 240, 255, 0.02) 1px, transparent 1px)"
      backgroundSize="20px 20px"
    >
      <Text
        fontSize="2xl"
        fontWeight="bold"
        mb={0}
        color="#00f0ff"
        textTransform="uppercase"
        letterSpacing="0.3em"
        textShadow="0 0 20px rgba(0, 240, 255, 0.5), 0 0 40px rgba(0, 240, 255, 0.2)"
      >
        SKYNET
      </Text>
      <Text
        fontSize="9px"
        color="#4a6a7a"
        mb={6}
        textTransform="uppercase"
        letterSpacing="0.25em"
      >
        LANGWATCH SYSTEMS
      </Text>

      <VStack align="stretch" spacing={1}>
        {navItems.map((item) => {
          const isActive = item.exact
            ? location.pathname === item.path
            : location.pathname.startsWith(item.path);
          return (
            <ChakraLink
              as={Link}
              key={item.path}
              to={item.path}
              px={3}
              py={2}
              borderRadius="2px"
              fontSize="sm"
              fontWeight={isActive ? "600" : "400"}
              textTransform="uppercase"
              letterSpacing="0.1em"
              bg={isActive ? "rgba(0, 240, 255, 0.06)" : "transparent"}
              color={isActive ? "#00f0ff" : "#6a8a9a"}
              borderLeft={isActive ? "2px solid #00f0ff" : "2px solid transparent"}
              _hover={{
                bg: "rgba(0, 240, 255, 0.06)",
                color: "#00f0ff",
                textDecoration: "none",
              }}
            >
              {item.label}
            </ChakraLink>
          );
        })}
      </VStack>
    </Box>
  );
}
