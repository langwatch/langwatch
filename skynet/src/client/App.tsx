import { useEffect, useRef, useCallback } from "react";
import { Flex, Box } from "@chakra-ui/react";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { Header } from "./components/layout/Header.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { GroupDetailPage } from "./pages/GroupDetailPage.tsx";
import { JobDetailPage } from "./pages/JobDetailPage.tsx";
import { ErrorInspectorPage } from "./pages/ErrorInspectorPage.tsx";
import { QueueListPage } from "./pages/QueueListPage.tsx";
import { QueueDetailPage } from "./pages/QueueDetailPage.tsx";
import { useDashboardData } from "./hooks/useDashboardData.ts";
import { useGroupsData } from "./hooks/useGroupsData.ts";

export function App() {
  const paused = useRef(false);
  const { data, status, flush } = useDashboardData(paused);
  const { queues, update: updateQueues, sortColumn, sortDir, cycleSort } = useGroupsData();

  // Feed groups data from dashboard SSE into the stable-sort hook
  useEffect(() => {
    if (data.queues.length > 0) {
      updateQueues(data.queues);
    }
  }, [data.queues, updateQueues]);

  const onPause = useCallback(() => {
    paused.current = true;
  }, []);

  const onResume = useCallback(() => {
    paused.current = false;
    flush();
  }, [flush]);

  const displayQueues = queues.length > 0 ? queues : data.queues;

  return (
    <Flex minH="100vh">
      <Sidebar />
      <Box flex="1">
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
              />
            }
          />
          <Route path="groups/:groupId" element={<GroupDetailPage />} />
          <Route path="jobs/:jobId" element={<JobDetailPage />} />
          <Route path="errors" element={<ErrorInspectorPage />} />
          <Route path="queues" element={<QueueListPage />} />
          <Route path="queues/:queueName" element={<QueueDetailPage />} />
        </Routes>
      </Box>
    </Flex>
  );
}
