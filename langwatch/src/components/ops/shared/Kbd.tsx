import { Box } from "@chakra-ui/react";

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as="kbd"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      paddingX={1}
      height="18px"
      minWidth="18px"
      borderRadius="sm"
      border="1px solid"
      borderColor="border"
      bg="bg.surface"
      fontSize="xs"
      fontFamily="mono"
      color="fg.muted"
    >
      {children}
    </Box>
  );
}
