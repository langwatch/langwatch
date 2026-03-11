import { useState, useEffect, useRef, useCallback } from "react";
import { Flex, Box } from "@chakra-ui/react";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { Header } from "./components/layout/Header.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { GroupDetailPage } from "./pages/GroupDetailPage.tsx";
import { JobDetailPage } from "./pages/JobDetailPage.tsx";
import { StatsPage } from "./pages/StatsPage.tsx";
import { UnblockSession, type UnblockSessionConfig } from "./components/UnblockSession.tsx";
import { useDashboardData } from "./hooks/useDashboardData.ts";
import { useGroupsData } from "./hooks/useGroupsData.ts";
import { useGroupsPolling } from "./hooks/useGroupsPolling.ts";

export function App() {
  const paused = useRef(false);
  const { data, status, flush } = useDashboardData(paused);
  const { queues: polledQueues, flush: flushGroups } = useGroupsPolling(paused);
  const { queues, update: updateQueues, sortColumn, sortDir, cycleSort } = useGroupsData();
  const [unblockSession, setUnblockSession] = useState<UnblockSessionConfig | null>(null);

  // Feed groups data from polling into the stable-sort hook
  // (groups are no longer included in SSE broadcasts to save memory)
  useEffect(() => {
    if (polledQueues.length > 0) {
      updateQueues(polledQueues);
    }
  }, [polledQueues, updateQueues]);

  const onPause = useCallback(() => {
    paused.current = true;
  }, []);

  const onResume = useCallback(() => {
    paused.current = false;
    flush();
    flushGroups();
  }, [flush, flushGroups]);

  const displayQueues = queues.length > 0 ? queues : polledQueues;

  return (
    <>
      <Flex minH="100vh">
        <Sidebar />
        <Box flex="1" minW={0} overflow="hidden">
          <Header status={status} paused={paused} />
          <Routes>
            <Route
              index
              element={
                <DashboardPage
                  data={data}
                  queues={displayQueues}
                  onPause={onPause}
                  onResume={onResume}
                  sortColumn={sortColumn}
                  sortDir={sortDir}
                  cycleSort={cycleSort}
                  onStartUnblockSession={setUnblockSession}
                />
              }
            />
            <Route path="stats" element={<StatsPage data={data} />} />
            <Route path="groups/:groupId" element={<GroupDetailPage />} />
            <Route path="jobs/:jobId" element={<JobDetailPage />} />
          </Routes>
        </Box>
      </Flex>
      {unblockSession && (
        <UnblockSession config={unblockSession} onClose={() => setUnblockSession(null)} />
      )}
    </>
  );
}
