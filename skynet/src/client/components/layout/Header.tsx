import { useState, useEffect } from "react";
import { Flex, Text, HStack } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import type { ConnectionStatus as Status } from "../../hooks/useSSE.ts";

function MilitaryTime() {
  const [time, setTime] = useState(() => formatTime());

  useEffect(() => {
    const interval = setInterval(() => setTime(formatTime()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text fontSize="xs" color="#00f0ff" letterSpacing="0.15em" opacity={0.7}>
      {time}
    </Text>
  );
}

function formatTime(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
}

export function Header({ status, paused }: { status: Status; paused: React.RefObject<boolean> }) {
  const navigate = useNavigate();

  return (
    <Flex
      h="50px"
      px={6}
      align="center"
      justify="space-between"
      borderBottom="1px solid"
      borderColor="rgba(0, 240, 255, 0.15)"
      bg="#0a0e17"
      boxShadow="0 2px 12px rgba(0, 240, 255, 0.08)"
    >
      <Text
        fontSize="xs"
        color="#00f0ff"
        textTransform="uppercase"
        letterSpacing="0.2em"
        fontWeight="bold"
        cursor="pointer"
        _hover={{ textShadow: "0 0 10px rgba(0, 240, 255, 0.5)" }}
        onClick={() => navigate("/")}
      >
        SKYNET // NEURAL NET OPERATIONS
      </Text>
      <HStack spacing={4}>
        <MilitaryTime />
        <ConnectionStatus status={status} paused={paused} />
      </HStack>
    </Flex>
  );
}
