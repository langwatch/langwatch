import { useState, useRef, useEffect, useCallback } from "react";
import {
  Box, Table, Thead, Tbody, Tr, Th, Td, Text, Badge, HStack, VStack, Code,
  Input, Button, Collapse, useDisclosure, Tooltip, useToast,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
  AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader,
  AlertDialogBody, AlertDialogFooter,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { ChevronRightIcon, ChevronDownIcon, TriangleUpIcon, TriangleDownIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { QueueInfo, GroupInfo, GroupDetailData } from "../../../shared/types.ts";
import type { SortColumn, SortDir } from "../../hooks/useGroupsData.ts";
import { QueueSummary } from "../dashboard/QueueSummary.tsx";
import { useTickingTimeAgo } from "../../hooks/useTickingTimeAgo.ts";
import { apiFetch, apiPost } from "../../hooks/useApi.ts";
import { ANTI_FLICKER_DURATION_MS, DEFAULT_GROUPS_DISPLAY_LIMIT, SEARCH_DEBOUNCE_MS } from "../../../shared/constants.ts";
import { CopyButton } from "../CopyButton.tsx";

const flashIncrease = keyframes`
  0% { background-color: rgba(0, 240, 255, 0.15); }
  100% { background-color: transparent; }
`;

const flashDecrease = keyframes`
  0% { background-color: rgba(0, 255, 65, 0.12); }
  100% { background-color: transparent; }
`;

const TABULAR_NUMS = { fontVariantNumeric: "tabular-nums" } as const;

function StatusBadge({ group, changed }: { group: GroupInfo; changed: boolean }) {
  const staleBg = changed ? "rgba(255, 170, 0, 0.2)" : "rgba(255, 170, 0, 0.12)";
  const staleColor = "#ffaa00";
  const blockedBg = changed ? "rgba(255, 0, 51, 0.25)" : "rgba(255, 0, 51, 0.15)";
  const blockedColor = "#ff0033";
  const okBg = changed ? "rgba(0, 255, 65, 0.2)" : "rgba(0, 255, 65, 0.12)";
  const okColor = "#00ff41";

  if (group.isStaleBlock) return <Badge bg={staleBg} color={staleColor} fontSize="10px" borderRadius="2px" transition="background-color 0.5s" textTransform="uppercase">Stale</Badge>;
  if (group.isBlocked) return <Badge bg={blockedBg} color={blockedColor} fontSize="10px" borderRadius="2px" transition="background-color 0.5s" textTransform="uppercase">Blocked</Badge>;
  return <Badge bg={okBg} color={okColor} fontSize="10px" borderRadius="2px" transition="background-color 0.5s" textTransform="uppercase">OK</Badge>;
}

function drainingOpacity(group: { _draining?: boolean; _drainingUntil?: number }): number {
  if (!group._draining || !group._drainingUntil) return 1;
  const remaining = group._drainingUntil - Date.now();
  if (remaining <= 0) return 0.3;
  const fraction = remaining / ANTI_FLICKER_DURATION_MS;
  return 0.3 + 0.7 * fraction;
}

function TickingTimeAgo({ ms }: { ms: number | null }) {
  const text = useTickingTimeAgo(ms);
  return <Text fontSize="xs" color="#4a6a7a">{text}</Text>;
}

interface GroupDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: GroupInfo | null;
  queueName: string;
}

function GroupDetailModal({ isOpen, onClose, group, queueName }: GroupDetailModalProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const { isOpen: timingOpen, onToggle: toggleTiming } = useDisclosure({ defaultIsOpen: true });
  const { isOpen: errorOpen, onToggle: toggleError } = useDisclosure({ defaultIsOpen: true });
  const { isOpen: isDrainOpen, onOpen: onDrainOpen, onClose: onDrainClose } = useDisclosure();
  const drainCancelRef = useRef<HTMLButtonElement>(null);
  const [draining, setDraining] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [blockDetail, setBlockDetail] = useState<GroupDetailData | null>(null);

  // Fetch block error details when a blocked group modal is opened
  useEffect(() => {
    if (!isOpen || !group?.isBlocked) {
      setBlockDetail(null);
      return;
    }
    const qs = `?queue=${encodeURIComponent(queueName)}`;
    apiFetch<GroupDetailData>(`/api/groups/${encodeURIComponent(group.groupId)}${qs}`)
      .then(setBlockDetail)
      .catch(() => {});
  }, [isOpen, group?.groupId, group?.isBlocked, queueName]);

  if (!group) return null;

  const groupUrl = `/groups/${encodeURIComponent(group.groupId)}?queue=${encodeURIComponent(queueName)}`;

  const handleDrain = async () => {
    setDraining(true);
    try {
      await apiPost("/api/actions/drain-group", { queueName, groupId: group.groupId });
      onDrainClose();
      onClose();
    } finally {
      setDraining(false);
    }
  };

  const handleRetry = async () => {
    if (!group.activeJobId) return;
    setRetrying(true);
    try {
      await apiPost("/api/actions/retry-blocked", { queueName, groupId: group.groupId, jobId: group.activeJobId });
      toast({ title: "Job retried and group unblocked", status: "success", duration: 2000, isClosable: true });
      setBlockDetail(null);
    } catch (err) {
      toast({ title: "Failed to retry", description: err instanceof Error ? err.message : "Unknown error", status: "error", duration: 4000, isClosable: true });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered>
      <ModalOverlay bg="rgba(0, 0, 0, 0.7)" />
      <ModalContent
        bg="#0a0e17"
        border="1px solid"
        borderColor={group.isBlocked ? "rgba(255, 0, 51, 0.4)" : "rgba(0, 240, 255, 0.4)"}
        boxShadow={group.isBlocked
          ? "0 0 30px rgba(255, 0, 51, 0.15), inset 0 0 20px rgba(255, 0, 51, 0.03)"
          : "0 0 30px rgba(0, 240, 255, 0.15), inset 0 0 20px rgba(0, 240, 255, 0.03)"}
        borderRadius="2px"
        maxW="750px"
      >
        <ModalHeader
          color="#00f0ff"
          fontSize="sm"
          textTransform="uppercase"
          letterSpacing="0.1em"
          borderBottom="1px solid"
          borderColor="rgba(0, 240, 255, 0.15)"
          pb={3}
        >
          Group Detail
        </ModalHeader>
        <ModalCloseButton color="#4a6a7a" _hover={{ color: "#00f0ff" }} />
        <ModalBody py={4}>
          <VStack align="stretch" spacing={3}>
            <HStack>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="110px">Group ID</Text>
              <Text fontFamily="mono" fontSize="xs" color="#6a8a9a" wordBreak="break-all">
                {group.groupId}
              </Text>
              <CopyButton value={group.groupId} />
            </HStack>
            <HStack>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="110px">Queue</Text>
              <Text fontSize="xs" color="#4a6a7a">{queueName}</Text>
              <CopyButton value={queueName} />
            </HStack>
            <HStack>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="110px">Pipeline</Text>
              <Text fontSize="xs" color="#4a6a7a">{group.pipelineName ?? "-"}</Text>
              {group.pipelineName && <CopyButton value={group.pipelineName} />}
            </HStack>
            <HStack>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="110px">Pending</Text>
              <Text fontWeight="600" color="#00f0ff">{group.pendingJobs}</Text>
            </HStack>
            <HStack>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="110px">Status</Text>
              <StatusBadge group={group} changed={false} />
            </HStack>
            {group.hasActiveJob && group.activeJobId && (
              <HStack>
                <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="110px">Active Job</Text>
                <Text fontFamily="mono" fontSize="xs" color="#00ff41" wordBreak="break-all">
                  {group.activeJobId}
                </Text>
                <CopyButton value={group.activeJobId} />
              </HStack>
            )}

            {/* Block error accordion — shown when group is blocked and error data is available */}
            {group.isBlocked && blockDetail?.blockError && (
              <Box
                mt={1}
                border="1px solid"
                borderColor="rgba(255, 0, 51, 0.2)"
                borderRadius="2px"
                overflow="hidden"
              >
                <HStack
                  px={3}
                  py={2}
                  cursor="pointer"
                  onClick={toggleError}
                  _hover={{ bg: "rgba(255, 0, 51, 0.04)" }}
                  userSelect="none"
                >
                  <Box color="#ff0033" fontSize="xs">
                    {errorOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  </Box>
                  <Text fontSize="xs" color="#ff0033" textTransform="uppercase" letterSpacing="0.1em">
                    Block Error
                  </Text>
                </HStack>
                <Collapse in={errorOpen}>
                  <VStack align="stretch" spacing={2} px={3} pb={3}>
                    <Text fontSize="xs" color="#ff6666" wordBreak="break-all">
                      {blockDetail.blockError}
                    </Text>
                    {blockDetail.blockStacktrace && blockDetail.blockStacktrace.length > 0 && (
                      <Code
                        display="block"
                        whiteSpace="pre-wrap"
                        wordBreak="break-all"
                        p={3}
                        bg="#060a12"
                        border="1px solid rgba(255, 0, 51, 0.1)"
                        borderRadius="2px"
                        fontSize="10px"
                        color="#cc6666"
                        maxH="200px"
                        overflow="auto"
                      >
                        {blockDetail.blockStacktrace.join("\n")}
                      </Code>
                    )}
                  </VStack>
                </Collapse>
              </Box>
            )}

            {/* Timing accordion */}
            <Box
              mt={1}
              border="1px solid"
              borderColor="rgba(0, 240, 255, 0.1)"
              borderRadius="2px"
              overflow="hidden"
            >
              <HStack
                px={3}
                py={2}
                cursor="pointer"
                onClick={toggleTiming}
                _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
                userSelect="none"
              >
                <Box color="#00f0ff" fontSize="xs">
                  {timingOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </Box>
                <Text fontSize="xs" color="#00f0ff" textTransform="uppercase" letterSpacing="0.1em">
                  Timing
                </Text>
              </HStack>
              <Collapse in={timingOpen}>
                <VStack align="stretch" spacing={2} px={3} pb={3}>
                  <HStack>
                    <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="110px">Oldest Job</Text>
                    <Text fontSize="xs" color="#4a6a7a">
                      <TickingTimeAgo ms={group.oldestJobMs} />
                      {group.oldestJobMs ? ` (${new Date(group.oldestJobMs).toISOString()})` : ""}
                    </Text>
                  </HStack>
                  <HStack>
                    <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="110px">Newest Job</Text>
                    <Text fontSize="xs" color="#4a6a7a">
                      <TickingTimeAgo ms={group.newestJobMs} />
                      {group.newestJobMs ? ` (${new Date(group.newestJobMs).toISOString()})` : ""}
                    </Text>
                  </HStack>
                </VStack>
              </Collapse>
            </Box>

            <HStack spacing={2} alignSelf="flex-end">
              {group.isBlocked && group.activeJobId && (
                <Button
                  size="sm"
                  variant="outline"
                  color="#ffaa00"
                  borderColor="rgba(255, 170, 0, 0.3)"
                  borderRadius="2px"
                  _hover={{ borderColor: "#ffaa00", boxShadow: "0 0 12px rgba(255, 170, 0, 0.3)" }}
                  textTransform="uppercase"
                  letterSpacing="0.1em"
                  fontSize="xs"
                  onClick={handleRetry}
                  isLoading={retrying}
                >
                  Retry
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                color="#ff0033"
                borderColor="rgba(255, 0, 51, 0.3)"
                borderRadius="2px"
                _hover={{ borderColor: "#ff0033", boxShadow: "0 0 12px rgba(255, 0, 51, 0.3)" }}
                textTransform="uppercase"
                letterSpacing="0.1em"
                fontSize="xs"
                onClick={onDrainOpen}
              >
                Drain Group
              </Button>
              <Button
                size="sm"
                variant="outline"
                color="#00f0ff"
                borderColor="rgba(0, 240, 255, 0.3)"
                borderRadius="2px"
                _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 12px rgba(0, 240, 255, 0.3)" }}
                textTransform="uppercase"
                letterSpacing="0.1em"
                fontSize="xs"
                onClick={() => navigate(groupUrl)}
              >
                View Full Page
              </Button>
            </HStack>
          </VStack>
        </ModalBody>
      </ModalContent>

      <AlertDialog isOpen={isDrainOpen} leastDestructiveRef={drainCancelRef} onClose={onDrainClose}>
        <AlertDialogOverlay>
          <AlertDialogContent bg="#0a0e17" border="1px solid rgba(255, 0, 51, 0.3)" borderRadius="2px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="#ff0033" textTransform="uppercase">
              Drain Group
            </AlertDialogHeader>
            <AlertDialogBody color="#b0c4d8">
              Remove all staged jobs for group <Text as="span" fontFamily="mono" color="#ff0033">{group.groupId}</Text>? This cannot be undone.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={drainCancelRef} onClick={onDrainClose} variant="ghost" color="#6a8a9a">Cancel</Button>
              <Button
                bg="rgba(255, 0, 51, 0.2)"
                color="#ff0033"
                border="1px solid rgba(255, 0, 51, 0.3)"
                _hover={{ bg: "rgba(255, 0, 51, 0.3)", boxShadow: "0 0 12px rgba(255, 0, 51, 0.3)" }}
                onClick={handleDrain}
                isLoading={draining}
                ml={3}
              >
                Drain
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Modal>
  );
}

interface GroupRowProps {
  group: GroupInfo & { _draining?: boolean; _drainingUntil?: number };
  queueName: string;
  onSelect: (group: GroupInfo) => void;
}

function GroupRow({ group, queueName, onSelect }: GroupRowProps) {
  const toast = useToast();
  const prevPending = useRef(group.pendingJobs);
  const prevStatus = useRef({ isBlocked: group.isBlocked, isStaleBlock: group.isStaleBlock });
  const [pendingAnimation, setPendingAnimation] = useState<string | undefined>(undefined);
  const [statusChanged, setStatusChanged] = useState(false);
  const [opacity, setOpacity] = useState(() => drainingOpacity(group));

  useEffect(() => {
    if (prevPending.current !== group.pendingJobs) {
      const anim = group.pendingJobs > prevPending.current
        ? `${flashIncrease} 1s ease-out`
        : `${flashDecrease} 1s ease-out`;
      setPendingAnimation(anim);
      prevPending.current = group.pendingJobs;
    }
  }, [group.pendingJobs]);

  useEffect(() => {
    if (
      prevStatus.current.isBlocked !== group.isBlocked ||
      prevStatus.current.isStaleBlock !== group.isStaleBlock
    ) {
      setStatusChanged(true);
      prevStatus.current = { isBlocked: group.isBlocked, isStaleBlock: group.isStaleBlock };
      const timer = setTimeout(() => setStatusChanged(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [group.isBlocked, group.isStaleBlock]);

  useEffect(() => {
    if (!group._draining) {
      setOpacity(1);
      return;
    }
    setOpacity(drainingOpacity(group));
    const interval = setInterval(() => {
      setOpacity(drainingOpacity(group));
    }, 200);
    return () => clearInterval(interval);
  }, [group._draining, group._drainingUntil]);

  const handleUnblock = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiPost("/api/actions/unblock", { queueName, groupId: group.groupId });
      toast({ title: "Group unblocked", status: "success", duration: 2000, isClosable: true });
    } catch (err) {
      toast({ title: "Failed to unblock", description: err instanceof Error ? err.message : "Unknown error", status: "error", duration: 4000, isClosable: true });
    }
  };

  const handleClick = () => {
    onSelect(group);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(group);
    }
  };

  return (
    <Tr
      cursor="pointer"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="row"
      _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
      bg={group.isStaleBlock ? "rgba(255, 170, 0, 0.03)" : group.isBlocked ? "rgba(255, 0, 51, 0.03)" : "transparent"}
      opacity={opacity}
      transition="opacity 0.3s"
    >
      <Td>
        <HStack spacing={1}>
          <Tooltip label={group.groupId} openDelay={200}>
            <Text fontFamily="mono" fontSize="xs" isTruncated color="#6a8a9a">
              {group.groupId}
            </Text>
          </Tooltip>
          <CopyButton value={group.groupId} />
        </HStack>
      </Td>
      <Td w="250px" maxW="250px">
        <HStack spacing={1}>
          <Tooltip label={group.pipelineName ?? "-"} openDelay={200}>
            <Text fontSize="xs" color="#4a6a7a" isTruncated>
              {group.pipelineName ?? "-"}
            </Text>
          </Tooltip>
          {group.pipelineName && <CopyButton value={group.pipelineName} />}
        </HStack>
      </Td>
      <Td isNumeric w="80px"
        animation={pendingAnimation}
        onAnimationEnd={() => setPendingAnimation(undefined)}
      >
        <Text fontWeight="600" color="#00f0ff" {...TABULAR_NUMS}>{group.pendingJobs}</Text>
      </Td>
      <Td w="90px">
        <Tooltip label={group.oldestJobMs ? new Date(group.oldestJobMs).toISOString() : ""}>
          <TickingTimeAgo ms={group.oldestJobMs} />
        </Tooltip>
      </Td>
      <Td w="90px">
        <Tooltip label={group.newestJobMs ? new Date(group.newestJobMs).toISOString() : ""}>
          <TickingTimeAgo ms={group.newestJobMs} />
        </Tooltip>
      </Td>
      <Td w="130px" maxW="130px">
        {group.hasActiveJob ? (
          <HStack spacing={1}>
            <Tooltip label={group.activeJobId ?? "yes"} openDelay={200}>
              <Text fontFamily="mono" fontSize="xs" color="#00ff41" maxW="100px" isTruncated>
                {group.activeJobId ?? "yes"}
              </Text>
            </Tooltip>
            {group.activeJobId && <CopyButton value={group.activeJobId} />}
          </HStack>
        ) : (
          <Text fontSize="xs" color="#4a6a7a">None</Text>
        )}
      </Td>
      <Td w="200px" px={4}>
        <HStack spacing={2}>
          <StatusBadge group={group} changed={statusChanged} />
          {group.isBlocked && (
            <Button
              size="xs"
              variant="outline"
              color="#ff0033"
              borderColor="rgba(255, 0, 51, 0.3)"
              _hover={{ borderColor: "#ff0033", boxShadow: "0 0 8px rgba(255, 0, 51, 0.3)" }}
              onClick={handleUnblock}
            >
              Unblock
            </Button>
          )}
        </HStack>
      </Td>
    </Tr>
  );
}

interface SortableThProps {
  label: string;
  column: SortColumn;
  currentSort: SortColumn;
  currentDir: SortDir;
  onSort: (col: SortColumn) => void;
  isNumeric?: boolean;
  w?: string;
}

function SortableTh({ label, column, currentSort, currentDir, onSort, isNumeric, w }: SortableThProps) {
  const active = currentSort === column;
  return (
    <Th
      cursor="pointer"
      onClick={() => onSort(column)}
      userSelect="none"
      isNumeric={isNumeric}
      w={w}
      _hover={{ color: "#00f0ff" }}
      color={active ? "#00f0ff" : undefined}
    >
      <HStack spacing={1} justify={isNumeric ? "flex-end" : "flex-start"}>
        <Text>{label}</Text>
        {active && (
          currentDir === "desc"
            ? <TriangleDownIcon boxSize="10px" />
            : <TriangleUpIcon boxSize="10px" />
        )}
      </HStack>
    </Th>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface GroupsTableProps {
  queues: QueueInfo[];
  onPause: () => void;
  onResume: () => void;
  sortColumn: SortColumn;
  sortDir: SortDir;
  cycleSort: (col: SortColumn) => void;
  pipelineFilter?: string | null;
}

export function GroupsTable({ queues, onPause, onResume, sortColumn, sortDir, cycleSort, pipelineFilter }: GroupsTableProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const filteredQueues = queues.map((queue) => ({
    ...queue,
    groups: queue.groups.filter(
      (g) => {
        const matchesSearch =
          g.groupId.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          (g.pipelineName ?? "").toLowerCase().includes(debouncedSearch.toLowerCase());
        // Pipeline filter matches any of: pipelineName, jobType, or jobName
        const matchesPipeline = !pipelineFilter ||
          (g.pipelineName ?? "") === pipelineFilter ||
          (g.jobType ?? "") === pipelineFilter ||
          (g.jobName ?? "") === pipelineFilter;
        return matchesSearch && matchesPipeline;
      },
    ),
  })).filter((q) => q.groups.length > 0);

  const sortedQueues = filteredQueues.map((queue) => {
    if (!sortColumn) return queue;
    const sorted = [...queue.groups].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "pendingJobs":
          cmp = a.pendingJobs - b.pendingJobs;
          break;
        case "groupId":
          cmp = a.groupId.localeCompare(b.groupId);
          break;
        case "pipelineName":
          cmp = (a.pipelineName ?? "").localeCompare(b.pipelineName ?? "");
          break;
        case "oldestJobMs":
          cmp = (a.oldestJobMs ?? 0) - (b.oldestJobMs ?? 0);
          break;
        case "newestJobMs":
          cmp = (a.newestJobMs ?? 0) - (b.newestJobMs ?? 0);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return { ...queue, groups: sorted };
  });

  return (
    <Box
      onMouseEnter={onPause}
      onMouseLeave={onResume}
    >
      <HStack mb={4}>
        <Input
          placeholder="SEARCH GROUPS OR PIPELINES..."
          size="sm"
          bg="#060a12"
          border="1px solid"
          borderColor="rgba(0, 240, 255, 0.25)"
          color="#b0c4d8"
          borderRadius="2px"
          _placeholder={{ color: "#4a6a7a", textTransform: "uppercase" }}
          _focus={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.2)" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={onPause}
          onBlur={onResume}
          maxW="400px"
        />
      </HStack>

      {sortedQueues.map((queue) => (
        <QueueSection
          key={queue.name}
          queue={queue}
          sortColumn={sortColumn}
          sortDir={sortDir}
          cycleSort={cycleSort}
        />
      ))}

      {sortedQueues.length === 0 && (
        <Box textAlign="center" py={10} color="#4a6a7a">
          <Text textTransform="uppercase" letterSpacing="0.1em">No groups found</Text>
        </Box>
      )}
    </Box>
  );
}

interface QueueSectionProps {
  queue: QueueInfo;
  sortColumn: SortColumn;
  sortDir: SortDir;
  cycleSort: (col: SortColumn) => void;
}

const ROW_HEIGHT = 36;
const VIRTUALIZE_THRESHOLD = 500;
const MAX_VISIBLE_ROWS = 20;

function QueueSection({ queue, sortColumn, sortDir, cycleSort }: QueueSectionProps) {
  const toast = useToast();
  const { isOpen, onToggle } = useDisclosure({ defaultIsOpen: true });
  const [showAll, setShowAll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Shared modal state — only one modal rendered per QueueSection
  const { isOpen: isModalOpen, onOpen: onModalOpen, onClose: onModalClose } = useDisclosure();
  const [selectedGroup, setSelectedGroup] = useState<GroupInfo | null>(null);

  const handleSelectGroup = useCallback((group: GroupInfo) => {
    setSelectedGroup(group);
    onModalOpen();
  }, [onModalOpen]);

  const totalCount = queue.groups.length;
  const isTruncated = !showAll && totalCount > DEFAULT_GROUPS_DISPLAY_LIMIT;
  const visibleGroups = isTruncated ? queue.groups.slice(0, DEFAULT_GROUPS_DISPLAY_LIMIT) : queue.groups;

  const needsVirtualization = visibleGroups.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: visibleGroups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => ROW_HEIGHT, []),
    overscan: 10,
  });

  const handleUnblockAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiPost("/api/actions/unblock-all", { queueName: queue.name });
      toast({ title: "All groups unblocked", status: "success", duration: 2000, isClosable: true });
    } catch (err) {
      toast({ title: "Failed to unblock all", description: err instanceof Error ? err.message : "Unknown error", status: "error", duration: 4000, isClosable: true });
    }
  };

  // Keep selectedGroup data in sync with latest SSE data
  useEffect(() => {
    if (selectedGroup && isModalOpen) {
      const updated = queue.groups.find((g) => g.groupId === selectedGroup.groupId);
      if (updated && updated !== selectedGroup) {
        setSelectedGroup(updated);
      }
    }
  }, [queue.groups, selectedGroup, isModalOpen]);

  const tableHeaders = (
    <Tr>
      <SortableTh label="Group ID" column="groupId" currentSort={sortColumn} currentDir={sortDir} onSort={cycleSort} />
      <SortableTh label="Pipeline" column="pipelineName" currentSort={sortColumn} currentDir={sortDir} onSort={cycleSort} w="250px" />
      <SortableTh label="Pending" column="pendingJobs" currentSort={sortColumn} currentDir={sortDir} onSort={cycleSort} isNumeric w="80px" />
      <SortableTh label="Oldest" column="oldestJobMs" currentSort={sortColumn} currentDir={sortDir} onSort={cycleSort} w="90px" />
      <SortableTh label="Newest" column="newestJobMs" currentSort={sortColumn} currentDir={sortDir} onSort={cycleSort} w="90px" />
      <Th w="130px">Active Job</Th>
      <Th w="200px">Status</Th>
    </Tr>
  );

  return (
    <Box
      bg="#0a0e17"
      borderRadius="2px"
      border="1px solid"
      borderColor="rgba(0, 240, 255, 0.15)"
      boxShadow="0 0 8px rgba(0, 240, 255, 0.08)"
      mb={4}
      overflow="hidden"
    >
      <HStack
        px={4}
        py={3}
        cursor="pointer"
        onClick={onToggle}
        _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
        userSelect="none"
      >
        <Box color="#00f0ff" fontSize="xs">
          {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Box>
        <Text
          fontWeight="600"
          fontSize="sm"
          color="#00f0ff"
          textTransform="uppercase"
          letterSpacing="0.1em"
        >
          {queue.displayName}
        </Text>
        <Text fontSize="xs" color="#4a6a7a" ml={2}>
          ({totalCount.toLocaleString()} groups)
        </Text>
        <Box ml="auto">
          <HStack spacing={2}>
            <QueueSummary queue={queue} />
            {queue.blockedGroupCount > 0 && (
              <Button
                size="xs"
                variant="outline"
                color="#ff0033"
                borderColor="rgba(255, 0, 51, 0.3)"
                _hover={{ borderColor: "#ff0033", boxShadow: "0 0 8px rgba(255, 0, 51, 0.3)" }}
                onClick={handleUnblockAll}
              >
                Unblock All
              </Button>
            )}
          </HStack>
        </Box>
      </HStack>

      <Collapse in={isOpen}>
        {needsVirtualization ? (
          <>
            <Box overflowX="auto">
              <Table size="sm" variant="simple" sx={{ tableLayout: "fixed" }}>
                <Thead>{tableHeaders}</Thead>
              </Table>
            </Box>
            <Box
              ref={scrollRef}
              overflowY="auto"
              overflowX="auto"
              maxH={`${MAX_VISIBLE_ROWS * ROW_HEIGHT}px`}
            >
              <Box style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
                <Table size="sm" variant="simple" sx={{ tableLayout: "fixed", position: "absolute", top: 0, left: 0, width: "100%" }}>
                  <Tbody>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const group = visibleGroups[virtualRow.index]!;
                      return (
                        <Box
                          key={group.groupId}
                          as="tbody"
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <GroupRow group={group} queueName={queue.name} onSelect={handleSelectGroup} />
                        </Box>
                      );
                    })}
                  </Tbody>
                </Table>
              </Box>
            </Box>
          </>
        ) : (
          <Box overflowX="auto">
            <Table size="sm" variant="simple" sx={{ tableLayout: "fixed" }}>
              <Thead>{tableHeaders}</Thead>
              <Tbody>
                {visibleGroups.length === 0 ? (
                  <Tr>
                    <Td colSpan={7} textAlign="center" color="#4a6a7a" py={6}>
                      No groups in staging
                    </Td>
                  </Tr>
                ) : (
                  visibleGroups.map((group) => (
                    <GroupRow key={group.groupId} group={group} queueName={queue.name} onSelect={handleSelectGroup} />
                  ))
                )}
              </Tbody>
            </Table>
          </Box>
        )}
        {isTruncated && (
          <Box textAlign="center" py={3} borderTop="1px solid" borderColor="rgba(0, 240, 255, 0.1)">
            <Button
              size="sm"
              variant="ghost"
              color="#00f0ff"
              _hover={{ bg: "rgba(0, 240, 255, 0.08)" }}
              onClick={() => setShowAll(true)}
              textTransform="uppercase"
              letterSpacing="0.05em"
              fontSize="xs"
            >
              Showing {DEFAULT_GROUPS_DISPLAY_LIMIT.toLocaleString()} of {totalCount.toLocaleString()} — Show All
            </Button>
          </Box>
        )}
        {showAll && totalCount > DEFAULT_GROUPS_DISPLAY_LIMIT && (
          <Box textAlign="center" py={3} borderTop="1px solid" borderColor="rgba(0, 240, 255, 0.1)">
            <Button
              size="sm"
              variant="ghost"
              color="#4a6a7a"
              _hover={{ bg: "rgba(0, 240, 255, 0.08)", color: "#00f0ff" }}
              onClick={() => setShowAll(false)}
              textTransform="uppercase"
              letterSpacing="0.05em"
              fontSize="xs"
            >
              Collapse to {DEFAULT_GROUPS_DISPLAY_LIMIT.toLocaleString()}
            </Button>
          </Box>
        )}
      </Collapse>

      {/* Single shared modal per QueueSection instead of one per row */}
      <GroupDetailModal
        isOpen={isModalOpen}
        onClose={onModalClose}
        group={selectedGroup}
        queueName={queue.name}
      />
    </Box>
  );
}
