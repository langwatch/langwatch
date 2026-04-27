import { Badge, Box, Button, HStack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

export function ReplayHeader({
  aggregateId,
  tenantId,
  eventCursor,
  eventCount,
  onBack,
}: {
  aggregateId: string;
  tenantId: string;
  eventCursor: number;
  eventCount: number;
  onBack: () => void;
}) {
  return (
    <HStack
      height="48px"
      flexShrink={0}
      paddingX={4}
      width="full"
      borderBottom="1px solid"
      borderBottomColor="border"
      gap={3}
      background="bg.surface"
    >
      <Button size="xs" variant="ghost" onClick={onBack}>
        <ArrowLeft size={14} />
        Back
      </Button>
      <Box height="20px" width="1px" bg="border" />
      <HStack gap={2}>
        <Text textStyle="xs" color="fg.muted">
          Aggregate:
        </Text>
        <Text textStyle="xs" fontFamily="mono" fontWeight="medium">
          {aggregateId}
        </Text>
      </HStack>
      <Box height="20px" width="1px" bg="border" />
      <HStack gap={2}>
        <Text textStyle="xs" color="fg.muted">
          Tenant:
        </Text>
        <Badge size="sm" variant="subtle">
          {tenantId}
        </Badge>
      </HStack>
      <Box flex={1} />
      <Badge size="sm" variant="outline" colorPalette="blue">
        Event {eventCount > 0 ? eventCursor + 1 : 0} / {eventCount}
      </Badge>
    </HStack>
  );
}
