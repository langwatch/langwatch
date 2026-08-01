import { Alert, Badge } from "@chakra-ui/react";
import { AlertTriangle } from "react-feather";
import { Tooltip } from "~/components/ui/tooltip";

interface ReachabilityReason {
  code: string;
  fields: string[];
}

interface ReachabilityDiagnostic {
  status: "unreachable";
  reasons: ReachabilityReason[];
}

function diagnosticDescription(diagnostic: ReachabilityDiagnostic): string {
  const codes = new Set(diagnostic.reasons.map((reason) => reason.code));
  const fields = [
    ...new Set(diagnostic.reasons.flatMap((reason) => reason.fields)),
  ];

  if (codes.has("invalid_filter_query")) {
    return "The saved filter query is invalid, so this automation cannot match a trace.";
  }
  if (codes.has("invalid_evaluation_state")) {
    const field = fields[0] ?? "evaluation state";
    return `The configured ${field} is outside the states an evaluation can have, so this automation cannot match.`;
  }

  const fieldCopy = fields.length > 0 ? `: ${fields.join(", ")}` : "";
  return `These condition fields cannot be evaluated when the automation fires${fieldCopy}.`;
}

export function AutomationReachabilityWarning({
  diagnostic,
  compact = false,
}: {
  diagnostic: ReachabilityDiagnostic | null | undefined;
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
