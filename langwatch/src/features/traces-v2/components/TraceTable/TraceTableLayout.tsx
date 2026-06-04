import { Box, Flex } from "@chakra-ui/react";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { useRefreshUIStore } from "../../stores/refreshUIStore";
import { RefreshProgressBar } from "../TracesPage/RefreshProgressBar";
import { FloatingConfigureCta } from "./FloatingConfigureCta";
import { NewTracesScrollUpIndicator } from "./NewTracesScrollUpIndicator";
import { Pagination } from "./Pagination";
import {
  releaseTraceTableScrollElement,
  setTraceTableScrollElement,
} from "./scrollContext";

interface TraceTableLayoutProps {
  totalHits: number;
  children: React.ReactNode;
  /**
   * When true, hide the pagination chrome (totals are unknown until
   * the first response lands) but keep the table shell so the skeleton
   * matches the eventual layout exactly.
   */
  isLoading?: boolean;
}

export const TraceTableLayout: React.FC<TraceTableLayoutProps> = ({
  totalHits,
  children,
  isLoading = false,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const ownedElRef = useRef<HTMLDivElement | null>(null);
  const isReplacingData = useRefreshUIStore((s) => s.isReplacingData);

  // Tracking which element this layout owns lets the store reject a
  // stale unmount-cleanup fire from clobbering a *newer* layout's
  // already-published element. This matters when the page swaps
  // between ResultsPane and EmptyResultsPane on tour activation:
  // React mounts the new layout (publishing its element) before
  // running the old layout's unmount cleanup, and an unconditional
  // `setRef(null)` would overwrite the live element with null.
  const setRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (el) {
      ownedElRef.current = el;
      setTraceTableScrollElement(el);
    } else if (ownedElRef.current) {
      releaseTraceTableScrollElement(ownedElRef.current);
      ownedElRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (ownedElRef.current) {
        releaseTraceTableScrollElement(ownedElRef.current);
        ownedElRef.current = null;
      }
    };
  }, []);

  return (
    <Flex direction="column" height="full" position="relative">
      <Box
        ref={setRef}
        flex={1}
        overflow="auto"
        opacity={isReplacingData ? 0.55 : 1}
        transition="opacity 150ms ease-out"
      >
        {children}
      </Box>
      <RefreshProgressBar />
      <NewTracesScrollUpIndicator scrollRef={scrollRef} />
      <FloatingConfigureCta />
      <Pagination totalHits={totalHits} isLoading={isLoading} />
    </Flex>
  );
};
