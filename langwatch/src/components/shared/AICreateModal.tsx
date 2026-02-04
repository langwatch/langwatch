import {
  Box,
  Button,
  HStack,
  Icon,
  Link,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { AlertCircle, AlertTriangle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Called when Generate is clicked, should handle the async generation */
  onGenerate: (description: string) => Promise<void>;
  /** Called when Skip is clicked */
  onSkip: () => void;
  /** Max character length (default: 500) */
  maxLength?: number;
  /** Text shown during generation (default: "Generating...") */
  generatingText?: string;
/** Whether model providers are configured (default: true) */
  hasModelProviders?: boolean;
  /** Called before any action - return false to block */
  onBeforeAction?: () => boolean;
}

type ModalState = "idle" | "generating" | "error";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_LENGTH = 500;
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
  maxLength = DEFAULT_MAX_LENGTH,
  generatingText = DEFAULT_GENERATING_TEXT,
hasModelProviders = true,
  onBeforeAction,
}: AICreateModalProps) {
  const [description, setDescription] = useState("");
  const [modalState, setModalState] = useState<ModalState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
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
      setErrorMessage("");
    }
  }, [open]);

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      // Truncate to maxLength if needed
      setDescription(value.slice(0, maxLength));
    },
    [maxLength]
  );

  const handleExampleClick = useCallback((templateText: string) => {
    setDescription(templateText.slice(0, maxLength));
  }, [maxLength]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    if (onBeforeAction && !onBeforeAction()) return;

    setModalState("generating");
    setErrorMessage("");

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutRef.current = setTimeout(() => {
        reject(new Error("Generation timed out. Please try again."));
      }, GENERATION_TIMEOUT_MS);
    });

    try {
      await Promise.race([onGenerate(description), timeoutPromise]);
    } catch (error) {
      setModalState("error");
      setErrorMessage(
        error instanceof Error ? error.message : "An unexpected error occurred"
      );
    } finally {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [description, onGenerate, onBeforeAction]);

  const handleTryAgain = useCallback(() => {
    void handleGenerate();
  }, [handleGenerate]);

  const handleSkip = useCallback(() => {
    if (onBeforeAction && !onBeforeAction()) return;
    onSkip();
  }, [onSkip, onBeforeAction]);

  const handleOpenChange = useCallback(
    (details: { open: boolean }) => {
      // Only allow closing when not generating
      if (!details.open && modalState !== "generating") {
        onClose();
      }
    },
    [modalState, onClose]
  );

  const characterCount = description.length;
  const showCloseButton = modalState !== "generating";

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content>
        {showCloseButton && <Dialog.CloseTrigger />}
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {!hasModelProviders && (
            <NoModelProvidersWarning />
          )}

          {hasModelProviders && modalState === "idle" && (
            <IdleState
              description={description}
              placeholder={placeholder}
              maxLength={maxLength}
              characterCount={characterCount}
              exampleTemplates={exampleTemplates}
              onDescriptionChange={handleDescriptionChange}
              onExampleClick={handleExampleClick}
            />
          )}

          {hasModelProviders && modalState === "generating" && <GeneratingState text={generatingText} />}

          {hasModelProviders && modalState === "error" && (
            <ErrorState errorMessage={errorMessage} />
          )}
        </Dialog.Body>
        <Dialog.Footer>
          {!hasModelProviders && (
            <NoModelProvidersFooter onSkip={onSkip} />
          )}

          {hasModelProviders && modalState === "idle" && (
            <IdleFooter
              onSkip={handleSkip}
              onGenerate={handleGenerate}
              isGenerateDisabled={!description.trim()}
            />
          )}

{hasModelProviders && modalState === "error" && (
            <ErrorFooter onSkip={handleSkip} onTryAgain={handleTryAgain} />
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
  maxLength: number;
  characterCount: number;
  exampleTemplates: ExampleTemplate[];
  onDescriptionChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onExampleClick: (text: string) => void;
}

function IdleState({
  description,
  placeholder,
  maxLength,
  characterCount,
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
          resize="none"
        />
        <Text fontSize="xs" color="fg.muted" textAlign="right" mt={1}>
          {characterCount} / {maxLength}
        </Text>
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
  errorMessage: string;
}

function ErrorState({ errorMessage }: ErrorStateProps) {
  return (
    <VStack gap={4} py={4}>
      <Box
        p={3}
        borderRadius="full"
        bg="red.100"
        color="red.600"
      >
        <Icon as={AlertCircle} boxSize={6} />
      </Box>
      <VStack gap={1}>
        <Text fontWeight="semibold">Something went wrong</Text>
        <Text color="fg.muted" fontSize="sm" textAlign="center">
          {errorMessage}
        </Text>
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
  onSkip: () => void;
  onTryAgain: () => void;
}

function ErrorFooter({ onSkip, onTryAgain }: ErrorFooterProps) {
  return (
    <HStack gap={2} justify="flex-end">
      <Button variant="ghost" onClick={onSkip}>
        I'll write it myself
      </Button>
      <Button colorPalette="blue" onClick={onTryAgain}>
        Try again
      </Button>
    </HStack>
  );
}

function NoModelProvidersWarning() {
  return (
    <VStack gap={4} py={8} align="center" justify="center">
      <Box
        p={3}
        borderRadius="full"
        bg="orange.100"
        color="orange.600"
      >
        <Icon as={AlertTriangle} boxSize={6} />
      </Box>
      <VStack gap={1}>
        <Text fontWeight="semibold">No model provider configured</Text>
        <Text color="fg.muted" fontSize="sm" textAlign="center">
          Scenarios require a model provider to run. Please configure one to get started.{" "}
          <Link
            href="/settings/model-providers"
            target="_blank"
            rel="noopener noreferrer"
            color="blue.500"
            fontWeight="medium"
          >
            Configure model provider
          </Link>
        </Text>
      </VStack>
    </VStack>
  );
}

interface NoModelProvidersFooterProps {
  onSkip: () => void;
}

function NoModelProvidersFooter({ onSkip }: NoModelProvidersFooterProps) {
  return (
    <HStack gap={2} justify="center" width="100%">
      <Button variant="ghost" onClick={onSkip}>
        I'll write it myself
      </Button>
    </HStack>
  );
}
