/**
 * What a started run with no messages yet reads: a few staged steps that advance on a timer.
 * Cosmetic only; the steps track no real progress and the last one spins until a message lands.
 */

import { HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";

const STEPS = [
  "Starting scenario execution environment",
  "Connecting to your agent",
  "Simulating the first user turn",
];
const STEP_INTERVAL_MS = 1500;

export function RunStartingSteps() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (current >= STEPS.length - 1) return;
    const timer = setTimeout(() => setCurrent(current + 1), STEP_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [current]);

  return (
    <VStack
      align="start"
      gap={2}
      paddingY={6}
      marginX="auto"
      width="fit-content"
      color="fg.muted"
      data-testid="run-starting-steps"
    >
      {STEPS.slice(0, current + 1).map((step, index) => (
        <HStack key={step} gap={2}>
          {index < current ? <CircleCheck size={14} /> : <Spinner size="xs" />}
          <Text fontSize="sm">{step}</Text>
        </HStack>
      ))}
    </VStack>
  );
}
