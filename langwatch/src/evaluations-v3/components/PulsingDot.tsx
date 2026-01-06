import { Box } from "@chakra-ui/react";

/**
 * Pulsing radar-style dot indicator for drawing attention to an action.
 */
export function PulsingDot() {
  return (
    <>
      <style>
        {`
          @keyframes evalRadar {
            0% { transform: scale(1); opacity: 0.6; }
            100% { transform: scale(2.5); opacity: 0; }
          }
        `}
      </style>
      <Box
        as="span"
        position="relative"
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        marginLeft={2}
      >
        {/* Expanding ring */}
        <Box
          as="span"
          position="absolute"
          width="8px"
          height="8px"
          borderRadius="full"
          bg="blue.300"
          style={{ animation: "evalRadar 1.5s ease-out infinite" }}
        />
        {/* Fixed center dot */}
        <Box
          as="span"
          position="relative"
          width="6px"
          height="6px"
          borderRadius="full"
          bg="blue.500"
        />
      </Box>
    </>
  );
}
