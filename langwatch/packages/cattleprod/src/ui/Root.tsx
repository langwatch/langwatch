import React, { useState, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import type IORedis from "ioredis";
import { type Environment, getEnvironmentConfig } from "../lib/environments.js";
import { getConnection } from "../lib/connection.js";
import { EnvSelect } from "./EnvSelect.js";
import { App } from "./App.js";

interface RootProps {
  initialEnv?: Environment;
}

type State =
  | { type: "select-env" }
  | { type: "connecting"; env: Environment }
  | { type: "connected"; env: Environment; connection: IORedis }
  | { type: "error"; message: string };

export const Root: React.FC<RootProps> = ({ initialEnv }) => {
  const { exit } = useApp();
  const [state, setState] = useState<State>(
    initialEnv ? { type: "connecting", env: initialEnv } : { type: "select-env" }
  );

  const handleEnvSelect = (env: Environment) => {
    setState({ type: "connecting", env });
  };

  useEffect(() => {
    if (state.type !== "connecting") return;

    const connect = async () => {
      try {
        const connection = await getConnection(state.env);
        setState({ type: "connected", env: state.env, connection });
      } catch (err) {
        setState({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    };

    connect();
  }, [state.type === "connecting" ? state.env : null]);

  if (state.type === "select-env") {
    return <EnvSelect onSelect={handleEnvSelect} />;
  }

  if (state.type === "connecting") {
    const config = getEnvironmentConfig(state.env);
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Connecting to {config.name}...
        </Text>
        {config.usePortForward && (
          <Text dimColor>Starting kubectl port-forward...</Text>
        )}
      </Box>
    );
  }

  if (state.type === "error") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          Connection Error
        </Text>
        <Text color="red">{state.message}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Ctrl+C to exit</Text>
        </Box>
      </Box>
    );
  }

  return <App connection={state.connection} env={state.env} />;
};
