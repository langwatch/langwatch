import {
  Box,
  Button,
  Code,
  Field,
  Heading,
  HStack,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Evaluator } from "@prisma/client";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import {
  setFlowCallbacks,
  useDrawer,
} from "~/hooks/useDrawer";
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
  activeTab: string;
} | null = null;

/** Clear persisted drawer state (for testing) */
export const clearGuardrailsDrawerState = () => {
  guardrailsDrawerState = null;
};

export function GuardrailsDrawer(props: GuardrailsDrawerProps) {
  const { closeDrawer, openDrawer } = useDrawer();

  const onClose = props.onClose ?? closeDrawer;
  const isOpen = props.open !== false && props.open !== undefined;

  // Initialize from persisted state or defaults
  const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(
    () => guardrailsDrawerState?.selectedEvaluator ?? null
  );
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState(
    () => guardrailsDrawerState?.activeTab ?? "python"
  );

  // Track previous open state to reset form when drawer opens fresh (no persisted state)
  // This effect must run BEFORE the persist effect to check the state before it's updated
  const prevIsOpenRef = useRef(isOpen);
  useEffect(() => {
    // If drawer is opening (was closed, now open) and there's no persisted state, reset form
    if (!prevIsOpenRef.current && isOpen && !guardrailsDrawerState) {
      setSelectedEvaluator(null);
      setActiveTab("python");
      setCopied(false);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  // Persist state changes to module-level storage
  useEffect(() => {
    if (isOpen) {
      guardrailsDrawerState = { selectedEvaluator, activeTab };
    }
  }, [isOpen, selectedEvaluator, activeTab]);

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
        guardrailsDrawerState = { selectedEvaluator: evaluator, activeTab };
      },
    });
    openDrawer("evaluatorList", {});
  }, [openDrawer, activeTab]);

  const handleClearEvaluator = useCallback(() => {
    setSelectedEvaluator(null);
  }, []);

  const handleCopy = (code: string) => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const evaluatorSlug = selectedEvaluator?.slug ?? "your-evaluator-slug";
  const apiKey = "<YOUR_LANGWATCH_API_KEY>";

  // Code snippets
  const pythonCode = `import langwatch

# Initialize LangWatch client
langwatch.api_key = "${apiKey}"

async def check_guardrail(input_text: str) -> dict:
    """
    Check if input passes the guardrail.
    Returns the evaluation result with pass/fail status.
    """
    result = await langwatch.guardrails.evaluate(
        evaluator="evaluators/${evaluatorSlug}",
        data={"input": input_text}
    )

    if not result.passed:
        # Handle failed guardrail (e.g., block request)
        raise ValueError(f"Guardrail failed: {result.details}")

    return result

# Example usage
async def handle_user_message(message: str):
    # Check guardrail before processing
    await check_guardrail(message)

    # Process the message...
    return generate_response(message)`;

  const typescriptCode = `import { LangWatch } from "langwatch";

// Initialize LangWatch client
const langwatch = new LangWatch({
  apiKey: "${apiKey}",
});

async function checkGuardrail(inputText: string) {
  /**
   * Check if input passes the guardrail.
   * Returns the evaluation result with pass/fail status.
   */
  const result = await langwatch.guardrails.evaluate({
    evaluator: "evaluators/${evaluatorSlug}",
    data: { input: inputText },
  });

  if (!result.passed) {
    // Handle failed guardrail (e.g., block request)
    throw new Error(\`Guardrail failed: \${result.details}\`);
  }

  return result;
}

// Example usage
async function handleUserMessage(message: string) {
  // Check guardrail before processing
  await checkGuardrail(message);

  // Process the message...
  return generateResponse(message);
}`;

  const curlCode = `curl -X POST "https://api.langwatch.ai/api/evaluations/evaluators/${evaluatorSlug}/evaluate" \\
  -H "X-Auth-Token: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "data": {
      "input": "Your input text here"
    }
  }'

# Response format:
# {
#   "passed": true,
#   "score": 1.0,
#   "details": "Evaluation details...",
#   "cost": { "amount": 0.001, "currency": "USD" }
# }`;

  const getCode = () => {
    switch (activeTab) {
      case "python":
        return pythonCode;
      case "typescript":
        return typescriptCode;
      case "curl":
        return curlCode;
      default:
        return pythonCode;
    }
  };

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
          <VStack gap={6} align="stretch">
            {/* Evaluator Selection */}
            <Field.Root>
              <Field.Label>Evaluator</Field.Label>
              <EvaluatorSelectionBox
                selectedEvaluator={selectedEvaluator}
                onSelectClick={handleSelectEvaluator}
                onClear={handleClearEvaluator}
                placeholder="Select Evaluator"
                placeholderDescription="Choose an evaluator to use as a guardrail"
                showSlug={true}
              />
            </Field.Root>

            {/* Code Integration - only shown when evaluator is selected */}
            {selectedEvaluator && (
              <>
                {/* Instructions */}
                <VStack align="start" gap={2}>
                  <Text fontWeight="medium">Integration Code</Text>
                  <Text fontSize="sm" color="gray.600">
                    Use the code below to integrate this guardrail into your application.
                    The guardrail will evaluate inputs before processing and can block
                    requests that fail the evaluation.
                  </Text>
                </VStack>

                {/* Code Block with Tabs */}
                <Box>
                  <Tabs.Root
                    value={activeTab}
                    onValueChange={({ value }) => setActiveTab(value)}
                  >
                    <HStack justify="space-between" marginBottom={2}>
                      <Tabs.List>
                        <Tabs.Trigger value="python">Python</Tabs.Trigger>
                        <Tabs.Trigger value="typescript">TypeScript</Tabs.Trigger>
                        <Tabs.Trigger value="curl">cURL</Tabs.Trigger>
                      </Tabs.List>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopy(getCode())}
                      >
                        {copied ? (
                          <>
                            <Check size={14} />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy size={14} />
                            Copy
                          </>
                        )}
                      </Button>
                    </HStack>
                    <Box
                      backgroundColor="gray.900"
                      borderRadius="md"
                      padding={4}
                      overflowX="auto"
                    >
                      <Tabs.Content value="python">
                        <Code
                          display="block"
                          whiteSpace="pre"
                          fontSize="sm"
                          color="gray.100"
                          backgroundColor="transparent"
                        >
                          {pythonCode}
                        </Code>
                      </Tabs.Content>
                      <Tabs.Content value="typescript">
                        <Code
                          display="block"
                          whiteSpace="pre"
                          fontSize="sm"
                          color="gray.100"
                          backgroundColor="transparent"
                        >
                          {typescriptCode}
                        </Code>
                      </Tabs.Content>
                      <Tabs.Content value="curl">
                        <Code
                          display="block"
                          whiteSpace="pre"
                          fontSize="sm"
                          color="gray.100"
                          backgroundColor="transparent"
                        >
                          {curlCode}
                        </Code>
                      </Tabs.Content>
                    </Box>
                  </Tabs.Root>
                </Box>

                {/* API Key Note */}
                <Box
                  padding={4}
                  borderWidth={1}
                  borderRadius="md"
                  borderColor="orange.200"
                  backgroundColor="orange.50"
                >
                  <Text fontSize="sm" color="orange.800">
                    <strong>Note:</strong> Replace <Code size="sm">{apiKey}</Code> with
                    your actual LangWatch API key. You can find it in your project
                    settings.
                  </Text>
                </Box>
              </>
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
