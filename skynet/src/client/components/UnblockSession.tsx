import { useState, useRef, useCallback, useEffect } from "react";
import {
  Box, Flex, Text, Button, HStack, VStack,
  NumberInput, NumberInputField, NumberInputStepper, NumberIncrementStepper, NumberDecrementStepper,
  Slider, SliderTrack, SliderFilledTrack, SliderThumb,
  Progress,
} from "@chakra-ui/react";
import { CloseIcon } from "@chakra-ui/icons";
import { apiPost } from "../hooks/useApi.ts";

export interface UnblockSessionConfig {
  queueName: string;
  displayName: string;
  dlqCount: number;
}

interface Props {
  config: UnblockSessionConfig;
  onClose: () => void;
}

type SessionState = "idle" | "running" | "paused" | "done";

export function UnblockSession({ config, onClose }: Props) {
  const [state, setState] = useState<SessionState>("idle");
  const [batchSize, setBatchSize] = useState(10);
  const [delayMs, setDelayMs] = useState(2000);
  const [processed, setProcessed] = useState(0);
  const [lastBatchCount, setLastBatchCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = false;

    setState("running");
    setError(null);

    while (!abortRef.current) {
      try {
        const res = await apiPost("/api/actions/canary-redrive", {
          queueName: config.queueName,
          count: batchSize,
        }) as { redrivenCount: number; groupIds: string[] };

        setLastBatchCount(res.redrivenCount);
        setProcessed((prev) => prev + res.redrivenCount);

        if (res.redrivenCount === 0) {
          setState("done");
          break;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
        setState("paused");
        break;
      }

      const start = Date.now();
      while (Date.now() - start < delayMs && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (abortRef.current && state !== "done") {
      setState("paused");
    }
    runningRef.current = false;
  }, [batchSize, delayMs, config.queueName]);

  const handleStart = () => run();
  const handlePause = () => { abortRef.current = true; };
  const handleResume = () => run();
  const handleStop = () => {
    abortRef.current = true;
    setState("idle");
    setProcessed(0);
    setLastBatchCount(0);
    setError(null);
  };

  useEffect(() => {
    return () => { abortRef.current = true; };
  }, []);

  // config.dlqCount may be stale (0) if scanner hasn't refreshed after Add to DLQ
  const estimatedTotal = Math.max(config.dlqCount, processed);
  const remaining = Math.max(0, estimatedTotal - processed);
  const progress = estimatedTotal > 0
    ? Math.min(100, (processed / estimatedTotal) * 100)
    : 0;

  return (
    <Box
      position="fixed"
      bottom={6}
      right={6}
      w="480px"
      bg="#0a0e17"
      border="1px solid"
      borderColor="rgba(0, 240, 255, 0.4)"
      borderRadius="4px"
      boxShadow="0 0 20px rgba(0, 240, 255, 0.15), 0 4px 20px rgba(0,0,0,0.5)"
      zIndex={1000}
      overflow="hidden"
    >
      <Flex
        px={5}
        py={3}
        bg="rgba(0, 240, 255, 0.08)"
        borderBottom="1px solid rgba(0, 240, 255, 0.2)"
        align="center"
        justify="space-between"
      >
        <HStack spacing={3}>
          <Text fontSize="sm" color="#00f0ff" fontWeight="600" textTransform="uppercase" letterSpacing="0.1em">
            DLQ Redrive
          </Text>
          <Text fontSize="xs" color="#4a6a7a" isTruncated maxW="180px">
            {config.displayName}
          </Text>
        </HStack>
        <Box
          as="button"
          color="#4a6a7a"
          _hover={{ color: "#ff0033" }}
          onClick={() => { abortRef.current = true; onClose(); }}
          p={1}
        >
          <CloseIcon boxSize="10px" />
        </Box>
      </Flex>

      <VStack spacing={4} p={5} align="stretch">
        <Box>
          <Flex justify="space-between" mb={2}>
            <Text fontSize="sm" color="#b0c4d8" fontWeight="600" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {processed.toLocaleString()} redriven
            </Text>
            <Text fontSize="sm" color="#4a6a7a" sx={{ fontVariantNumeric: "tabular-nums" }}>
              ~{remaining.toLocaleString()} remaining
            </Text>
          </Flex>
          <Progress
            value={progress}
            size="sm"
            borderRadius="2px"
            bg="rgba(0, 240, 255, 0.1)"
            sx={{ "& > div": { bg: state === "done" ? "#00ff41" : "#00f0ff", transition: "width 0.3s" } }}
          />
          {lastBatchCount > 0 && state === "running" && (
            <Text fontSize="xs" color="#4a6a7a" mt={1}>
              Last batch: {lastBatchCount} groups
            </Text>
          )}
        </Box>

        <Flex gap={4}>
          <Box flex="1">
            <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" mb={1.5}>
              Batch size
            </Text>
            <NumberInput
              size="sm"
              min={1}
              max={500}
              value={batchSize}
              onChange={(_, val) => setBatchSize(val || 10)}
              isDisabled={state === "running"}
            >
              <NumberInputField
                bg="#060a12"
                border="1px solid rgba(0, 240, 255, 0.2)"
                color="#b0c4d8"
                borderRadius="2px"
                _focus={{ borderColor: "#00f0ff" }}
              />
              <NumberInputStepper>
                <NumberIncrementStepper color="#4a6a7a" borderColor="rgba(0, 240, 255, 0.2)" />
                <NumberDecrementStepper color="#4a6a7a" borderColor="rgba(0, 240, 255, 0.2)" />
              </NumberInputStepper>
            </NumberInput>
          </Box>
          <Box flex="1">
            <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" mb={1.5}>
              Delay between batches: {(delayMs / 1000).toFixed(1)}s
            </Text>
            <Slider
              min={0}
              max={10000}
              step={500}
              value={delayMs}
              onChange={setDelayMs}
              isDisabled={state === "running"}
              mt={3}
            >
              <SliderTrack bg="rgba(0, 240, 255, 0.1)" h="6px" borderRadius="2px">
                <SliderFilledTrack bg="#00f0ff" />
              </SliderTrack>
              <SliderThumb boxSize="14px" bg="#00f0ff" />
            </Slider>
          </Box>
        </Flex>

        {error && (
          <Text fontSize="sm" color="#ff0033">
            {error}
          </Text>
        )}

        <HStack spacing={3} justify="flex-end">
          {state === "running" && (
            <Button
              size="md"
              variant="outline"
              color="#00f0ff"
              borderColor="rgba(0, 240, 255, 0.3)"
              borderRadius="2px"
              _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.3)" }}
              fontSize="sm"
              textTransform="uppercase"
              letterSpacing="0.05em"
              onClick={handlePause}
              px={6}
            >
              Pause
            </Button>
          )}
          {(state === "idle" || state === "paused") && (
            <Button
              size="md"
              variant="outline"
              color="#00ff41"
              borderColor="rgba(0, 255, 65, 0.3)"
              borderRadius="2px"
              _hover={{ borderColor: "#00ff41", boxShadow: "0 0 8px rgba(0, 255, 65, 0.3)" }}
              fontSize="sm"
              textTransform="uppercase"
              letterSpacing="0.05em"
              onClick={state === "idle" ? handleStart : handleResume}
              px={6}
            >
              {state === "idle" ? "Start" : "Resume"}
            </Button>
          )}
          {state !== "idle" && state !== "done" && (
            <Button
              size="md"
              variant="outline"
              color="#ff0033"
              borderColor="rgba(255, 0, 51, 0.3)"
              borderRadius="2px"
              _hover={{ borderColor: "#ff0033", boxShadow: "0 0 8px rgba(255, 0, 51, 0.3)" }}
              fontSize="sm"
              textTransform="uppercase"
              letterSpacing="0.05em"
              onClick={handleStop}
              px={6}
            >
              Reset
            </Button>
          )}
          {state === "done" && (
            <Text fontSize="sm" color="#00ff41" fontWeight="600" textTransform="uppercase">
              Complete
            </Text>
          )}
        </HStack>
      </VStack>
    </Box>
  );
}
