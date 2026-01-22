import {
  Box,
  Button,
  Heading,
  HStack,
  Link,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Evaluator } from "@prisma/client";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import {
  setFlowCallbacks,
  useDrawer,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { RenderCode } from "../code/RenderCode";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { EvaluatorSelectionBox } from "./EvaluatorSelectionBox";

export type GuardrailsDrawerProps = {
  open?: boolean;
  onClose?: () => void;
};

/**
 * Drawer for setting up guardrails.
 * Shows evaluator selection, then displays code integration after selection.
 */
// Module-level state to persist across drawer navigation (component unmounts/remounts)
let guardrailsDrawerState: {
  selectedEvaluator: Evaluator | null;
  activeLanguage: string;
} | null = null;

/** Clear persisted drawer state (for testing) */
export const clearGuardrailsDrawerState = () => {
  guardrailsDrawerState = null;
};

export function GuardrailsDrawer(props: GuardrailsDrawerProps) {
  const { closeDrawer, openDrawer, goBack } = useDrawer();
  const { project } = useOrganizationTeamProject();

  const onClose = props.onClose ?? closeDrawer;
  const isOpen = props.open !== false && props.open !== undefined;

  // Initialize from persisted state or defaults
  const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(
    () => guardrailsDrawerState?.selectedEvaluator ?? null
  );
  const [activeLanguage, setActiveLanguage] = useState(
    () => guardrailsDrawerState?.activeLanguage ?? "python-async"
  );

  // Track previous open state to reset form when drawer opens fresh (no persisted state)
  // This effect must run BEFORE the persist effect to check the state before it's updated
  const prevIsOpenRef = useRef(isOpen);
  useEffect(() => {
    // If drawer is opening (was closed, now open) and there's no persisted state, reset form
    if (!prevIsOpenRef.current && isOpen && !guardrailsDrawerState) {
      setSelectedEvaluator(null);
      setActiveLanguage("python-async");
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  // Persist state changes to module-level storage
  useEffect(() => {
    if (isOpen) {
      guardrailsDrawerState = { selectedEvaluator, activeLanguage };
    }
  }, [isOpen, selectedEvaluator, activeLanguage]);

  // Clear persisted state when drawer truly closes (via close button, not navigation)
  const handleClose = useCallback(() => {
    guardrailsDrawerState = null;
    onClose();
  }, [onClose]);

  const handleSelectEvaluator = useCallback(() => {
    // Set flow callback for evaluator selection
    setFlowCallbacks("evaluatorList", {
      onSelect: (evaluator: Evaluator) => {
        setSelectedEvaluator(evaluator);
        // Also update persisted state immediately
        guardrailsDrawerState = { selectedEvaluator: evaluator, activeLanguage };
        // Navigate back to guardrails drawer after selection
        goBack();
      },
    });
    openDrawer("evaluatorList", {});
  }, [openDrawer, activeLanguage, goBack]);

  const evaluatorSlug = selectedEvaluator?.slug ?? "your-evaluator-slug";
  const evaluatorName = selectedEvaluator?.name ?? "My Guardrail";

  // Code snippets using environment variable
  const pythonAsyncCode = `import langwatch

# Uses LANGWATCH_API_KEY environment variable

async def llm_step(user_input: str):
    # ... your existing code

    guardrail = await langwatch.evaluation.async_evaluate(
        "${evaluatorSlug}",
        data={
            "input": user_input
        },
        name="${evaluatorName}",
        as_guardrail=True,
    )

    if not guardrail.passed:
        # handle the guardrail here
        return "I'm sorry, I can't do that."

    # ... continue with your LLM call`;

  const pythonSyncCode = `import langwatch

# Uses LANGWATCH_API_KEY environment variable

def llm_step(user_input: str):
    # ... your existing code

    guardrail = langwatch.evaluation.evaluate(
        "${evaluatorSlug}",
        data={
            "input": user_input
        },
        name="${evaluatorName}",
        as_guardrail=True,
    )

    if not guardrail.passed:
        # handle the guardrail here
        return "I'm sorry, I can't do that."

    # ... continue with your LLM call`;

  const typescriptCode = `import { LangWatch } from "langwatch";

// Uses LANGWATCH_API_KEY environment variable
const langwatch = new LangWatch();

async function llmStep(message: string): Promise<string> {
    // ... your existing code

    // call the guardrail
    const guardrail = await langwatch.evaluations.evaluate(
      "${evaluatorSlug}",
      {
        data: {
          input: message
        },
        name: "${evaluatorName}",
        asGuardrail: true,
      }
    );

    if (!guardrail.passed) {
        // handle the guardrail here
        return "I'm sorry, I can't do that.";
    }

    // ... continue with your LLM call
}`;

  const curlCode = `# Set your API key
API_KEY="$LANGWATCH_API_KEY"

# Use curl to send the POST request
curl -X POST "https://app.langwatch.ai/api/evaluations/${evaluatorSlug}/evaluate" \\
     -H "X-Auth-Token: $API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
{
  "name": "${evaluatorName}",
  "data": {
    "input": "input content"
  },
  "as_guardrail": true
}
EOF

# Response:
# {
#   "status": "processed",
#   "passed": true,
#   "score": 1,
#   "details": "possible explanation"
# }`;

  const getCode = () => {
    switch (activeLanguage) {
      case "python-async":
        return pythonAsyncCode;
      case "python":
        return pythonSyncCode;
      case "typescript":
        return typescriptCode;
      case "bash":
        return curlCode;
      default:
        return pythonAsyncCode;
    }
  };

  const getLanguageForHighlight = () => {
    switch (activeLanguage) {
      case "python-async":
      case "python":
        return "python";
      case "typescript":
        return "typescript";
      case "bash":
        return "bash";
      default:
        return "python";
    }
  };

  const apiKeyLink = project ? `/${project.slug}/settings` : "/settings";

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Heading size="md">New Guardrail</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={0} align="stretch">
            {/* Evaluator Selection */}
            <HorizontalFormControl
              label="Evaluator"
              helper="Select an evaluator to use as a guardrail"
            >
              <EvaluatorSelectionBox
                selectedEvaluator={selectedEvaluator}
                onSelectClick={handleSelectEvaluator}
                placeholder="Select Evaluator"
                showSlug={true}
              />
            </HorizontalFormControl>

            {/* Code Integration - only shown when evaluator is selected */}
            {selectedEvaluator && (
              <HorizontalFormControl
                label="Integration Code"
                helper="Use the code below to integrate this guardrail into your application"
                direction="vertical"
                align="start"
                labelProps={{
                  paddingLeft: 0,
                }}
              >
                <VStack align="stretch" gap={4} width="full">
                  <NativeSelect.Root width="170px">
                    <NativeSelect.Field
                      value={activeLanguage}
                      onChange={(e) => setActiveLanguage(e.target.value)}
                    >
                      <option value="python-async">Python (async)</option>
                      <option value="python">Python</option>
                      <option value="typescript">TypeScript</option>
                      <option value="bash">cURL</option>
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>

                  <Box borderRadius="md" overflow="hidden" width="full">
                    <RenderCode
                      code={getCode()}
                      language={getLanguageForHighlight()}
                      style={{ padding: "16px", width: "100%" }}
                    />
                  </Box>

                  <Text fontSize="sm" color="gray.600">
                    Set the <code>LANGWATCH_API_KEY</code> environment variable with your API key.{" "}
                    <Link
                      href={apiKeyLink}
                      color="blue.500"
                      display="inline-flex"
                      alignItems="center"
                      gap={1}
                    >
                      Find your API key <ExternalLink size={12} />
                    </Link>
                  </Text>
                  <Text fontSize="sm" color="gray.600">
                    Learn more about running guardrails in our{" "}
                    <Link
                      href="https://langwatch.ai/docs/evaluations/guardrails/overview"
                      color="blue.500"
                      display="inline-flex"
                      alignItems="center"
                      gap={1}
                      target="_blank"
                    >
                      documentation <ExternalLink size={12} />
                    </Link>
                  </Text>
                </VStack>
              </HorizontalFormControl>
            )}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
