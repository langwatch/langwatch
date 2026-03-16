import { Box, Button, HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";

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

  return (
    <Box
      padding={4}
      borderRadius="lg"
      border="1px solid"
      borderColor="gray.200"
      background="bg.panel"
    >
      <VStack align="stretch" gap={2}>
        <HStack justify="space-between">
          <Text fontSize="sm">
            Exported {exported} of {total} traces...
          </Text>
          {onCancel && (
            <Button variant="ghost" size="xs" onClick={onCancel}>
              <X size={14} />
              Cancel
            </Button>
          )}
        </HStack>
        <Progress.Root value={percentage}>
          <Progress.Track>
            <Progress.Range />
          </Progress.Track>
        </Progress.Root>
      </VStack>
    </Box>
  );
}
