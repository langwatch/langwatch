import {
  Box,
  Button,
  HStack,
  Icon,
  Progress,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

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
  // Animate mount/unmount with a slight delay
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isExporting) {
      // Trigger slide-in on next frame so transition applies
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isExporting]);

  if (!isExporting) {
    return null;
  }

  const percentage = total > 0 ? Math.round((exported / total) * 100) : 0;
  const isDone = total > 0 && exported >= total;
  const isPreparing = total === 0;

  return (
    <Box
      padding={3}
      borderRadius="lg"
      borderWidth="1px"
      borderColor={isDone ? "green.muted" : "border.muted"}
      bg="bg.panel"
      boxShadow="lg"
      css={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition:
          "opacity 0.3s ease-out, transform 0.3s ease-out, border-color 0.3s ease",
      }}
    >
      <VStack align="stretch" gap={2}>
        <HStack justify="space-between" gap={3}>
          {isDone ? (
            <HStack gap={2}>
              <Icon boxSize={3.5} color="green.fg">
                <Check />
              </Icon>
              <Text textStyle="sm" color="green.fg" fontWeight="medium">
                Exported {total.toLocaleString()} traces
              </Text>
            </HStack>
          ) : isPreparing ? (
            <HStack gap={2}>
              <Spinner size="xs" color="fg.muted" />
              <Text textStyle="sm" color="fg.muted">
                Preparing export…
              </Text>
            </HStack>
          ) : (
            <Text textStyle="sm" color="fg">
              Exported {exported.toLocaleString()} of {total.toLocaleString()} traces…
            </Text>
          )}
          {!isDone && onCancel && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onCancel}
              aria-label="Cancel export"
            >
              <X size={14} />
              Cancel
            </Button>
          )}
        </HStack>
        <Progress.Root
          value={isPreparing ? null : percentage}
          colorPalette={isDone ? "green" : "blue"}
          size="xs"
          css={{ transition: "all 0.3s ease" }}
        >
          <Progress.Track>
            <Progress.Range css={{ transition: "width 0.5s ease-in-out" }} />
          </Progress.Track>
        </Progress.Root>
      </VStack>
    </Box>
  );
}
