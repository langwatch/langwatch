import React from "react";
import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { motion } from "motion/react";

export function WaitingForTracesChip(): React.ReactElement {
  return (
    <Box
      position="fixed"
      left="50%"
      bottom="24px"
      transform="translateX(-50%)"
      zIndex={10}
    >
      <motion.div
        initial={{ boxShadow: "0 0 0 0 rgba(251,146,60,0.55)" }}
        animate={{
          boxShadow: [
            "0 0 0 0 rgba(251,146,60,0.55)",
            "0 0 0 16px rgba(251,146,60,0)",
            "0 0 0 0 rgba(251,146,60,0)",
          ],
        }}
        transition={{ duration: 1.6, ease: "easeOut", repeat: Infinity }}
        style={{ borderRadius: 9999 }}
      >
        <HStack
          bg="bg"
          borderRadius="full"
          borderWidth="1px"
          borderColor="orange.400"
          px={4}
          py={2}
          gap={2}
        >
          <Spinner color="orange.500" borderWidth="2px" animationDuration="0.6s" size="sm" />
          <Text fontWeight="medium" fontSize="sm">Waiting to receive traces…</Text>
        </HStack>
      </motion.div>
    </Box>
  );
}


