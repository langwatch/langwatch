import { Icon } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";
import { Check, XCircle, Clock, Loader, Slash } from "lucide-react";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import type { ScenarioRunRow } from "../types";

export function StatusCell({
  getValue,
}: CellContext<ScenarioRunRow, unknown>) {
  const status = getValue() as ScenarioRunStatus;

  switch (status) {
    case ScenarioRunStatus.SUCCESS:
      return <Icon as={Check} color="green.400" boxSize={4} />;
    case ScenarioRunStatus.ERROR:
    case ScenarioRunStatus.FAILED:
      return <Icon as={XCircle} color="red.400" boxSize={4} />;
    case ScenarioRunStatus.IN_PROGRESS:
      return <Icon as={Loader} color="blue.400" boxSize={4} />;
    case ScenarioRunStatus.PENDING:
      return <Icon as={Clock} color="yellow.500" boxSize={4} />;
    case ScenarioRunStatus.CANCELLED:
      return <Icon as={Slash} color="gray.400" boxSize={4} />;
    default:
      return <Icon as={Clock} color="gray.400" boxSize={4} />;
  }
}
