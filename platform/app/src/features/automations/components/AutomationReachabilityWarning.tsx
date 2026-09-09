import { Alert, Badge } from "@chakra-ui/react";
import { AlertTriangle } from "react-feather";
import { Tooltip } from "~/components/ui/tooltip";
import type { AutomationReachabilityDiagnostic } from "~/server/app-layer/automations/automation-reachability";

function diagnosticDescription(
  diagnostic: AutomationReachabilityDiagnostic,
): string {
  const fields = [
    ...new Set(diagnostic.reasons.flatMap((reason) => reason.fields)),
  ];

  if (diagnostic.reasons.some(({ code }) => code === "invalid_filter_query")) {
    return "Fix the saved filter query so this automation can match traces.";
  }
  const invalidEvaluationState = diagnostic.reasons.find(
    ({ code }) => code === "invalid_evaluation_state",
  );
  if (invalidEvaluationState) {
    const field = invalidEvaluationState.fields[0] ?? "evaluation state";
    return `Update ${field} to a supported evaluation state so this automation can match traces.`;
  }

  const fieldCopy = fields.length > 0 ? `: ${fields.join(", ")}` : "";
  return `Update or remove these condition fields so this automation can match traces${fieldCopy}.`;
}

export function AutomationReachabilityWarning({
  diagnostic,
  compact = false,
}: {
  diagnostic: AutomationReachabilityDiagnostic | null | undefined;
  compact?: boolean;
}) {
  if (!diagnostic) return null;
  const description = diagnosticDescription(diagnostic);

  if (compact) {
    return (
      <Tooltip content={description}>
        <Badge colorPalette="orange" variant="subtle" gap={1} cursor="help">
          <AlertTriangle size={11} /> Cannot fire
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Alert.Root role="alert" status="warning" size="sm" width="full">
      <Alert.Indicator>
        <AlertTriangle size={16} />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Title>Conditions cannot match</Alert.Title>
        <Alert.Description>{description}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
