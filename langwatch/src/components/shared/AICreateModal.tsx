import {
  Box,
  Button,
  Code,
  HStack,
  Icon,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { AlertCircle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { classifyGenerationError } from "../scenarios/utils/classifyGenerationError";
import { Dialog } from "../ui/dialog";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExampleTemplate {
  label: string;
  text: string;
}

export interface AICreateModalProps {
  /** Controls modal visibility */
  open: boolean;
  /** Called when modal is closed */
  onClose: () => void;
  /** Modal title */
  title: string;
  /** Textarea placeholder text */
  placeholder?: string;
  /** Example pill templates */
  exampleTemplates: ExampleTemplate[];
  /** Called when Generate is clicked. Return undefined to block (no generating state shown). */
  onGenerate: (description: string) => Promise<void> | undefined;
  /** Called when Skip is clicked */
  onSkip: () => void;
  /** Text shown during generation (default: "Generating...") */
  generatingText?: string;
}

type ModalState = "idle" | "generating" | "error";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PLACEHOLDER =
  "Describe your scenario. What does your agent do? What situation do you want to test?";
const DEFAULT_GENERATING_TEXT = "Generating...";
const GENERATION_TIMEOUT_MS = 60000;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function AICreateModal({
  open,
  onClose,
  title,
  placeholder = DEFAULT_PLACEHOLDER,
  exampleTemplates,
  onGenerate,
  onSkip,
  generatingText = DEFAULT_GENERATING_TEXT,
}: AICreateModalProps) {
  const [description, setDescription] = useState("");
  const [modalState, setModalState] = useState<ModalState>("idle");
  const [capturedError, setCapturedError] = useState<unknown>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount or when state changes
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setDescription("");
      setModalState("idle");
      setCapturedError(null);
    }
  }, [open]);

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDescription(e.target.value);
    },
    []
  );

  const handleExampleClick = useCallback((templateText: string) => {
    setDescription(templateText);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;

    // Call onGenerate first - if it returns undefined, the action was blocked
    const generationPromise = onGenerate(description);
    if (!generationPromise) return;

    // Action is proceeding - show generating state
    setModalState("generating");
    setCapturedError(null);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutRef.current = setTimeout(() => {
        reject(new Error("Generation timed out. Please try again."));
      }, GENERATION_TIMEOUT_MS);
    });

    try {
      await Promise.race([generationPromise, timeoutPromise]);
    } catch (error) {
      console.error("[AICreateModal] generation error:", error);
      setModalState("error");
      setCapturedError(error);
    } finally {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [description, onGenerate]);

  const handleTryAgain = useCallback(() => {
    void handleGenerate();
  }, [handleGenerate]);

  const handleSkip = useCallback(() => {
    onSkip();
  }, [onSkip]);

  const handleOpenChange = useCallback(
    (details: { open: boolean }) => {
      // Only allow closing when not generating
      if (!details.open && modalState !== "generating") {
        onClose();
      }
    },
    [modalState, onClose]
  );

  const showCloseButton = modalState !== "generating";

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content>
        {showCloseButton && <Dialog.CloseTrigger />}
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {modalState === "idle" && (
            <IdleState
              description={description}
              placeholder={placeholder}
              exampleTemplates={exampleTemplates}
              onDescriptionChange={handleDescriptionChange}
              onExampleClick={handleExampleClick}
            />
          )}

          {modalState === "generating" && <GeneratingState text={generatingText} />}

          {modalState === "error" && <ErrorState error={capturedError} />}
        </Dialog.Body>
        <Dialog.Footer>
          {modalState === "idle" && (
            <IdleFooter
              onSkip={handleSkip}
              onGenerate={handleGenerate}
              isGenerateDisabled={!description.trim()}
            />
          )}

          {modalState === "error" && (
            <ErrorFooter
              error={capturedError}
              onSkip={handleSkip}
              onTryAgain={handleTryAgain}
            />
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

interface IdleStateProps {
  description: string;
  placeholder: string;
  exampleTemplates: ExampleTemplate[];
  onDescriptionChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onExampleClick: (text: string) => void;
}

function IdleState({
  description,
  placeholder,
  exampleTemplates,
  onDescriptionChange,
  onExampleClick,
}: IdleStateProps) {
  return (
    <VStack align="stretch" gap={4}>
      <Box>
        <Textarea
          placeholder={placeholder}
          value={description}
          onChange={onDescriptionChange}
          rows={5}
          resize="vertical"
        />
      </Box>

      <Box>
        <Text fontSize="sm" color="fg.muted" mb={2}>
          Try an example:
        </Text>
        <HStack gap={2} flexWrap="wrap">
          {exampleTemplates.map((template) => (
            <Button
              key={template.label}
              size="xs"
              variant="outline"
              onClick={() => onExampleClick(template.text)}
            >
              {template.label}
            </Button>
          ))}
        </HStack>
      </Box>
    </VStack>
  );
}

interface GeneratingStateProps {
  text: string;
}

function GeneratingState({ text }: GeneratingStateProps) {
  return (
    <VStack gap={4} py={8}>
      <Spinner size="lg" color="blue.500" />
      <Text color="fg.muted">{text}</Text>
    </VStack>
  );
}

interface ErrorStateProps {
  error: unknown;
}

function ErrorState({ error }: ErrorStateProps) {
  const classified = classifyGenerationError(error);

  return (
    <VStack gap={4} py={4}>
      <Box p={3} borderRadius="full" bg="red.100" color="red.600">
        <Icon as={AlertCircle} boxSize={6} />
      </Box>
      <VStack gap={1}>
        <Text fontWeight="semibold">Something went wrong</Text>
        <Text color="fg.muted" fontSize="sm" textAlign="center">
          {classified.copy}
        </Text>
        {classified.tier === "unknown" && classified.rawMessage && (
          <Code
            fontSize="xs"
            mt={2}
            px={2}
            py={1}
            borderRadius="md"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            maxW="100%"
          >
            {classified.rawMessage}
          </Code>
        )}
      </VStack>
    </VStack>
  );
}

interface IdleFooterProps {
  onSkip: () => void;
  onGenerate: () => void;
  isGenerateDisabled: boolean;
}

function IdleFooter({ onSkip, onGenerate, isGenerateDisabled }: IdleFooterProps) {
  return (
    <HStack gap={2} justify="flex-end">
      <Button variant="ghost" onClick={onSkip}>
        I'll write it myself
      </Button>
      <Button
        colorPalette="blue"
        onClick={onGenerate}
        disabled={isGenerateDisabled}
      >
        <Sparkles size={14} />
        Generate with AI
      </Button>
    </HStack>
  );
}

interface ErrorFooterProps {
  error: unknown;
  onSkip: () => void;
  onTryAgain: () => void;
}

function ErrorFooter({ error, onSkip, onTryAgain }: ErrorFooterProps) {
  const classified = classifyGenerationError(error);

  const showConfigure =
    classified.cta === "configure" || classified.cta === "configure-and-retry";
  const showRetry =
    classified.cta === "retry" ||
    classified.cta === "configure-and-retry" ||
    classified.cta === "retry-or-skip";

  return (
    <HStack gap={2} justify="flex-end">
      <Button variant="ghost" onClick={onSkip}>
        I'll write it myself
      </Button>
      {showConfigure && (
        <Button colorPalette="blue" asChild>
          <a
            data-testid="error-configure-model-provider-button"
            href="/settings/model-providers"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "white" }}
          >
            Configure model provider
          </a>
        </Button>
      )}
      {showRetry && (
        <Button colorPalette="blue" onClick={onTryAgain}>
          Try again
        </Button>
      )}
    </HStack>
  );
}

