import { useRef, useMemo } from "react";
import { Box, Flex, Text, VStack, Badge, Code, Collapse, useDisclosure } from "@chakra-ui/react";
import { ChevronRightIcon, ChevronDownIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import type { ErrorCluster } from "../../../shared/types.ts";

interface ErrorRowProps {
  cluster: ErrorCluster;
  queueName: string | null;
}

function ErrorRow({ cluster, queueName }: ErrorRowProps) {
  const { isOpen, onToggle } = useDisclosure();
  const navigate = useNavigate();

  const handleGroupClick = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const qs = queueName ? `?queue=${encodeURIComponent(queueName)}` : "";
    navigate(`/groups/${encodeURIComponent(groupId)}${qs}`);
  };

  return (
    <Box
      border="1px solid"
      borderColor="rgba(255, 0, 51, 0.15)"
      borderRadius="2px"
      overflow="hidden"
      w="100%"
    >
      <Flex
        px={3}
        py={2}
        cursor="pointer"
        onClick={onToggle}
        _hover={{ bg: "rgba(255, 0, 51, 0.04)" }}
        userSelect="none"
        gap={3}
        align="center"
        w="100%"
        overflow="hidden"
      >
        <Box color="#ff0033" fontSize="xs" flexShrink={0}>
          {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Box>
        <Badge
          bg="rgba(255, 0, 51, 0.2)"
          color="#ff0033"
          fontSize="11px"
          borderRadius="2px"
          minW="40px"
          textAlign="center"
          flexShrink={0}
          sx={{ fontVariantNumeric: "tabular-nums" }}
        >
          {cluster.count}
        </Badge>
        {cluster.pipelineName && (
          <Badge
            bg="rgba(0, 240, 255, 0.1)"
            color="#00f0ff"
            fontSize="9px"
            borderRadius="2px"
            textTransform="none"
            flexShrink={0}
            maxW="150px"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            {cluster.pipelineName}
          </Badge>
        )}
        <Box flex="1" minW={0} overflow="hidden">
          <Text
            fontSize="xs"
            color="#ff6666"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            display="block"
          >
            {cluster.normalizedMessage}
          </Text>
        </Box>
      </Flex>
      <Collapse in={isOpen}>
        <Box px={3} pb={3} overflow="hidden">
          <VStack align="stretch" spacing={2}>
            <Text fontSize="xs" color="#ff6666" overflowWrap="anywhere" wordBreak="break-word">
              {cluster.sampleMessage}
            </Text>
            {cluster.sampleStack && (
              <Code
                display="block"
                whiteSpace="pre-wrap"
                overflowWrap="anywhere"
                p={2}
                bg="#060a12"
                border="1px solid rgba(255, 0, 51, 0.1)"
                borderRadius="2px"
                fontSize="10px"
                color="#cc6666"
                maxH="150px"
                overflowY="auto"
                overflowX="hidden"
              >
                {cluster.sampleStack}
              </Code>
            )}
            <Flex gap={1} flexWrap="wrap" align="center">
              <Text fontSize="9px" color="#4a6a7a" textTransform="uppercase">Groups:</Text>
              {cluster.sampleGroupIds.map((id) => (
                <Badge
                  key={id}
                  fontSize="9px"
                  bg="rgba(0, 240, 255, 0.08)"
                  color="#6a8a9a"
                  borderRadius="2px"
                  fontFamily="mono"
                  cursor="pointer"
                  _hover={{ bg: "rgba(0, 240, 255, 0.2)", color: "#00f0ff" }}
                  onClick={(e) => handleGroupClick(id, e)}
                >
                  {id.length > 24 ? id.slice(0, 24) + "\u2026" : id}
                </Badge>
              ))}
            </Flex>
          </VStack>
        </Box>
      </Collapse>
    </Box>
  );
}

interface TopErrorsPanelProps {
  errors: ErrorCluster[];
  queueName: string | null;
  onPause?: () => void;
  onResume?: () => void;
}

export function TopErrorsPanel({ errors, queueName, onPause, onResume }: TopErrorsPanelProps) {
  // Stabilize ordering: once we've seen an error, keep its position.
  // This prevents rows from jumping around every 2s refresh.
  const orderRef = useRef<string[]>([]);

  const stableErrors = useMemo(() => {
    const known = new Set(orderRef.current);
    const keyOf = (c: ErrorCluster) => `${c.pipelineName ?? ""}::${c.normalizedMessage}`;

    // Add any new error keys to the end of the stable order
    for (const c of errors) {
      const k = keyOf(c);
      if (!known.has(k)) {
        orderRef.current.push(k);
        known.add(k);
      }
    }

    // Build a map for quick lookup
    const errorMap = new Map<string, ErrorCluster>();
    for (const c of errors) errorMap.set(keyOf(c), c);

    // Return errors in stable order, filtering out any that disappeared
    const result: ErrorCluster[] = [];
    const surviving: string[] = [];
    for (const k of orderRef.current) {
      const c = errorMap.get(k);
      if (c) {
        result.push(c);
        surviving.push(k);
      }
    }
    orderRef.current = surviving;
    return result;
  }, [errors]);

  if (stableErrors.length === 0) return null;

  return (
    <Box
      bg="#0a0e17"
      p={4}
      borderRadius="2px"
      border="1px solid"
      borderColor="rgba(255, 0, 51, 0.2)"
      boxShadow="0 0 8px rgba(255, 0, 51, 0.08)"
      overflow="hidden"
      maxW="100%"
      minW={0}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
    >
      <Text
        fontSize="xs"
        color="#ff0033"
        fontWeight="600"
        textTransform="uppercase"
        letterSpacing="0.15em"
        mb={3}
      >
        // Top Errors ({stableErrors.reduce((sum, e) => sum + e.count, 0)} blocked groups)
      </Text>
      <VStack spacing={2} align="stretch">
        {stableErrors.map((cluster) => (
          <ErrorRow key={`${cluster.pipelineName ?? ""}::${cluster.normalizedMessage}`} cluster={cluster} queueName={queueName} />
        ))}
      </VStack>
    </Box>
  );
}
