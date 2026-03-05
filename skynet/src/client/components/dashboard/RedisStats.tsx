import { HStack, Text } from "@chakra-ui/react";
import type { DashboardData } from "../../../shared/types.ts";

export function RedisStats({ data }: { data: DashboardData }) {
  return (
    <HStack spacing={4} fontSize="xs" color="#4a6a7a" mb={4}>
      <Text>
        <Text as="span" color="#00f0ff" mr={1}>SYS //</Text>
        Memory: <Text as="span" color="#6a8a9a">{data.redisMemoryUsed}</Text> (peak <Text as="span" color="#6a8a9a">{data.redisMemoryPeak}</Text>)
      </Text>
      <Text>
        Clients: <Text as="span" color="#6a8a9a">{data.redisConnectedClients}</Text>
      </Text>
    </HStack>
  );
}
