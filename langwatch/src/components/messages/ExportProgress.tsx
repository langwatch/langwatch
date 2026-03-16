import { Box, Button, HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { Check, X } from "lucide-react";

interface ExportProgressProps {
  exported: number;
  total: number;
  isExporting: boolean;
  onCancel?: () => void;
}

export function ExportProgress({
  exported,
  total,
  isExporting,
  onCancel,
}: ExportProgressProps) {
  if (!isExporting) {
    return null;
  }

  const percentage = total > 0 ? Math.round((exported / total) * 100) : 0;
  const isDone = total > 0 && exported >= total;

  return (
    <Box
      padding={4}
      borderRadius="lg"
      border="1px solid"
      borderColor={isDone ? "green.200" : "gray.200"}
      background="bg.panel"
      boxShadow="lg"
    >
      <VStack align="stretch" gap={2}>
        <HStack justify="space-between">
          {isDone ? (
            <HStack gap={2}>
              <Check size={14} color="green" />
              <Text fontSize="sm" color="green.600">
                Exported {total} traces
              </Text>
            </HStack>
          ) : (
            <Text fontSize="sm">
              {total > 0
                ? `Exported ${exported} of ${total} traces...`
                : "Preparing export..."}
            </Text>
          )}
          {!isDone && onCancel && (
            <Button variant="ghost" size="xs" onClick={onCancel}>
              <X size={14} />
              Cancel
            </Button>
          )}
        </HStack>
        <Progress.Root
          value={percentage}
          colorPalette={isDone ? "green" : "orange"}
        >
          <Progress.Track>
            <Progress.Range />
          </Progress.Track>
        </Progress.Root>
      </VStack>
    </Box>
  );
}
