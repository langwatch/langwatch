import { EmptyValue } from "@langwatch/design-system/empty-value";
import { HStack, Spinner, Text } from "@langwatch/design-system/primitives";
import { LuCircleCheckBig, LuCircleX } from "react-icons/lu";

import type { RunStatus } from "../../../model/experiments/experiment-list-row.ts";

/** The latest run's state in words: Completed, Stopped, Running, or an empty mark if none ran. */
export function ExperimentRunStatus({ status }: { status: RunStatus }) {
  return (
    <HStack gap={1}>
      {status === "completed" && (
        <>
          <LuCircleCheckBig size={14} color="var(--chakra-colors-green-fg)" />
          <Text textStyle="bodySm">Completed</Text>
        </>
      )}
      {status === "stopped" && (
        <>
          <LuCircleX size={14} color="var(--chakra-colors-red-fg)" />
          <Text textStyle="bodySm">Stopped</Text>
        </>
      )}
      {status === "running" && (
        <>
          <Spinner size="xs" />
          <Text textStyle="bodySm">Running</Text>
        </>
      )}
      {status === "none" && <EmptyValue label="Never run" />}
    </HStack>
  );
}
