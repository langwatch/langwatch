import { Box, Flex } from "@chakra-ui/react";
import type React from "react";
import { useRef } from "react";
import { useRefreshUIStore } from "../../stores/refreshUIStore";
import { RefreshProgressBar } from "../TracesPage/RefreshProgressBar";
import { NewTracesScrollUpIndicator } from "./NewTracesScrollUpIndicator";
import { Pagination } from "./Pagination";
import { useRegisterTraceTableScrollRef } from "./scrollContext";

interface TraceTableLayoutProps {
  totalHits: number;
  children: React.ReactNode;
}

export const TraceTableLayout: React.FC<TraceTableLayoutProps> = ({
  totalHits,
  children,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isReplacingData = useRefreshUIStore((s) => s.isReplacingData);
  useRegisterTraceTableScrollRef(scrollRef);

  return (
    <Flex direction="column" height="full" position="relative">
      <Box
        ref={scrollRef}
        flex={1}
        overflow="auto"
        opacity={isReplacingData ? 0.55 : 1}
        transition="opacity 150ms ease-out"
      >
        {children}
      </Box>
      <RefreshProgressBar />
      <NewTracesScrollUpIndicator scrollRef={scrollRef} />
      <Pagination totalHits={totalHits} />
    </Flex>
  );
};
