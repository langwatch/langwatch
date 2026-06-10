import { Box, Flex } from "@chakra-ui/react";
import { motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { useRefreshUIStore } from "../../stores/refreshUIStore";
import { RefreshProgressBar } from "../TracesPage/RefreshProgressBar";
import { ColumnEducationDialog } from "./ColumnEducationDialog";
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
  /**
   * True when the lens body has no rows (data is empty or skeleton is
   * filling the slot). Used to crossfade between the data and empty
   * states without remounting per-row aurora animations.
   */
  isEmpty?: boolean;
}

export const TraceTableLayout: React.FC<TraceTableLayoutProps> = ({
  totalHits,
  children,
  isLoading = false,
  isEmpty = false,
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
        opacity={isReplacingData ? 0.6 : 1}
        transition="opacity 150ms ease-out"
        pointerEvents={isReplacingData ? "none" : "auto"}
        aria-busy={isReplacingData ? true : undefined}
      >
        <motion.div
          key={isEmpty ? "empty" : "data"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: "easeInOut" }}
        >
          {children}
        </motion.div>
      </Box>
      <RefreshProgressBar />
      <NewTracesScrollUpIndicator scrollRef={scrollRef} />
      <ColumnEducationDialog />
      <Pagination totalHits={totalHits} isLoading={isLoading} />
    </Flex>
  );
};
