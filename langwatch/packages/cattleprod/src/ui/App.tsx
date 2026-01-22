import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import type IORedis from "ioredis";
import { type Environment, getEnvironmentConfig } from "../lib/environments.js";
import { QueueList } from "./QueueList.js";
import { JobInspector } from "./JobInspector.js";
import { FailedJobs } from "./FailedJobs.js";
import { RequeueScreen } from "./RequeueScreen.js";
import { WatchScreen } from "./WatchScreen.js";

type Screen =
  | { type: "menu" }
  | { type: "list" }
  | { type: "watch" }
  | { type: "inspect"; jobId?: string }
  | { type: "failed" }
  | { type: "requeue"; jobId?: string };

interface AppProps {
  connection: IORedis;
  env: Environment;
}

const menuItems = [
  { label: "📋 List all queues", value: "list" },
  { label: "📊 Watch queues (live)", value: "watch" },
  { label: "🔍 Inspect a job", value: "inspect" },
  { label: "📛 View failed jobs", value: "failed" },
  { label: "🔄 Requeue failed jobs", value: "requeue" },
  { label: "🚪 Exit", value: "exit" },
];

export const App: React.FC<AppProps> = ({ connection, env }) => {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ type: "menu" });
  const [error, setError] = useState<string | null>(null);
  const envConfig = getEnvironmentConfig(env);

  useInput((input, key) => {
    if (key.escape || (input === "q" && screen.type !== "inspect")) {
      if (screen.type === "menu") {
        exit();
      } else {
        setScreen({ type: "menu" });
        setError(null);
      }
    }
  });

  const handleSelect = (item: { value: string }) => {
    switch (item.value) {
      case "list":
        setScreen({ type: "list" });
        break;
      case "watch":
        setScreen({ type: "watch" });
        break;
      case "inspect":
        setScreen({ type: "inspect" });
        break;
      case "failed":
        setScreen({ type: "failed" });
        break;
      case "requeue":
        setScreen({ type: "requeue" });
        break;
      case "exit":
        exit();
        break;
    }
  };

  const handleBack = () => {
    setScreen({ type: "menu" });
    setError(null);
  };

  const handleInspectJob = (jobId: string) => {
    setScreen({ type: "inspect", jobId });
  };

  const handleRequeueJob = (jobId: string) => {
    setScreen({ type: "requeue", jobId });
  };

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          Error: {error}
        </Text>
        <Text dimColor>Press Escape or q to go back</Text>
      </Box>
    );
  }

  switch (screen.type) {
    case "menu":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1} justifyContent="space-between">
            <Text bold color="cyan">
              🐄⚡ Cattleprod
            </Text>
            <Text color={env === "prod" ? "red" : "green"}>
              [{envConfig.name}]
            </Text>
          </Box>
          <SelectInput items={menuItems} onSelect={handleSelect} />
          <Box marginTop={1}>
            <Text dimColor>Use arrow keys to navigate, Enter to select, q to quit</Text>
          </Box>
        </Box>
      );

    case "list":
      return (
        <QueueList
          connection={connection}
          onBack={handleBack}
          onInspectJob={handleInspectJob}
        />
      );

    case "watch":
      return <WatchScreen connection={connection} onBack={handleBack} />;

    case "inspect":
      return (
        <JobInspector
          connection={connection}
          initialJobId={screen.jobId}
          onBack={handleBack}
          onRequeue={handleRequeueJob}
        />
      );

    case "failed":
      return (
        <FailedJobs
          connection={connection}
          onBack={handleBack}
          onInspectJob={handleInspectJob}
          onRequeueJob={handleRequeueJob}
        />
      );

    case "requeue":
      return (
        <RequeueScreen
          connection={connection}
          initialJobId={screen.jobId}
          onBack={handleBack}
        />
      );
  }
};
