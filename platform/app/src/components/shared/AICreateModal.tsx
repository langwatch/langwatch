import {
  Box,
  Button,
  chakra,
  Code,
  HStack,
  Icon,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { AlertCircle, ArrowRight, PencilLine, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LangyMark,
  LangyMarkGradientDefs,
} from "~/features/langy/components/LangyMark";
import "~/features/langy/langyTheme.css";
import { CARD } from "~/features/asaplangy";
import { classifyGenerationError } from "../scenarios/utils/classifyGenerationError";
import { Dialog } from "../ui/dialog";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExampleTemplate {
  label: string;
  text: string;
}

export interface AICreateAssistant {
  /** Product-facing assistant name, for example "Langy". */
  name: string;
  /** One-line explanation of what the assistant will produce. */
  description: string;
  /** Label above the prompt composer. */
  promptLabel?: string;
  /** Visible primary action label. */
  generateLabel?: string;
  /** Reassurance shown while the draft is being produced. */
  reviewHint?: string;
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
  /** Rendered on the left of the idle footer, e.g. which model generation uses */
  footerHint?: React.ReactNode;
  /** Turns the generic generator into a named, guided assistant surface. */
  assistant?: AICreateAssistant;
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
  footerHint,
  assistant,
}: AICreateModalProps) {
  const [description, setDescription] = useState("");
  const [modalState, setModalState] = useState<ModalState>("idle");
  // Which starting path the user is on. Only meaningful when `assistant` is set —
  // that's the surface that offers the choice between letting the assistant draft
  // and building it by hand. Defaults to the assisted path (the value-add), but
  // the toggle keeps the manual path visibly one click away, so it never reads as
  // "you must use the assistant".
  const [startMode, setStartMode] = useState<"assist" | "manual">("assist");
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
      setStartMode("assist");
      setCapturedError(null);
    }
  }, [open]);

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDescription(e.target.value);
    },
    [],
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
    [modalState, onClose],
  );

  const showCloseButton = modalState !== "generating";

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content
        className={assistant ? "langy-root" : undefined}
        // A calm LangWatch surface. The one warm accent lives on the docked
        // composer (the assisted path), not smeared across the whole dialog — so
        // the wash is NOT combined here (a `bg` shorthand + `backgroundImage` on
        // one element is order-fragile in Emotion, which is why LangyPanelSurface
        // layers its wash separately rather than mixing the two).
        bg={assistant ? CARD.bg : "bg"}
        maxWidth={assistant ? "620px" : undefined}
        overflow="hidden"
        borderWidth={assistant ? "1px" : undefined}
        borderColor={assistant ? CARD.border : undefined}
        // A plain deep shadow — no purple "AI" glow. LangWatch's chrome is a
        // hairline and one warm accent, not a spectrum.
        boxShadow={
          assistant ? "0 28px 90px -32px rgba(2, 6, 23, 0.62)" : undefined
        }
      >
        {assistant && <LangyMarkGradientDefs />}
        {showCloseButton && <Dialog.CloseTrigger />}
        <Dialog.Header pb={assistant ? 3 : undefined}>
          {assistant ? (
            <HStack align="start" gap={3} paddingRight={8}>
              <Box
                display="grid"
                placeItems="center"
                width="42px"
                height="42px"
                flexShrink={0}
                borderRadius="12px"
                borderWidth="1px"
                borderColor="border.muted"
                bg="bg.surface"
              >
                <LangyMark size={27} />
              </Box>
              <Box>
                <HStack gap={2} align="baseline" flexWrap="wrap">
                  <Dialog.Title>{title}</Dialog.Title>
                  {/* Langy's name rides the header only while the user is on the
                      assisted path — on the manual tab this is just "Create new
                      scenario", so nothing implies the assistant is mandatory. */}
                  {startMode === "assist" && (
                    <Text
                      fontSize="xs"
                      fontWeight="semibold"
                      color="fg.muted"
                      letterSpacing="0.04em"
                    >
                      with {assistant.name}
                    </Text>
                  )}
                </HStack>
                <Text color="fg.muted" fontSize="sm" marginTop={1}>
                  {startMode === "manual"
                    ? `Build the scenario yourself. ${assistant.name} stays one click away if you want a first draft.`
                    : assistant.description}
                </Text>
              </Box>
            </HStack>
          ) : (
            <Dialog.Title>{title}</Dialog.Title>
          )}
        </Dialog.Header>
        <Dialog.Body pb={assistant ? 4 : undefined}>
          {modalState === "idle" &&
            (assistant ? (
              <VStack align="stretch" gap={5}>
                {/* Two ways to start, side by side — the assistant never looks
                    like the only door. */}
                <StartModeToggle
                  mode={startMode}
                  onChange={setStartMode}
                  assistantName={assistant.name}
                />
                {startMode === "assist" ? (
                  <VStack align="stretch" gap={4}>
                    <Box>
                      <Text
                        mb={2}
                        fontSize="11px"
                        fontWeight="bold"
                        color="fg.muted"
                        letterSpacing="0.1em"
                        textTransform="uppercase"
                      >
                        {assistant.promptLabel ??
                          `Tell ${assistant.name} what to test`}
                      </Text>
                      <Textarea
                        placeholder={placeholder}
                        value={description}
                        onChange={handleDescriptionChange}
                        rows={6}
                        resize="vertical"
                        fontSize="md"
                      />
                    </Box>
                    <InspirationChips
                      assistantName={assistant.name}
                      templates={exampleTemplates}
                      onTemplate={handleExampleClick}
                    />
                  </VStack>
                ) : (
                  <ManualStartState assistantName={assistant.name} />
                )}
              </VStack>
            ) : (
              <IdleState
                description={description}
                placeholder={placeholder}
                exampleTemplates={exampleTemplates}
                onDescriptionChange={handleDescriptionChange}
                onExampleClick={handleExampleClick}
              />
            ))}

          {modalState === "generating" && (
            <GeneratingState text={generatingText} assistant={assistant} />
          )}

          {modalState === "error" && <ErrorState error={capturedError} />}
        </Dialog.Body>
        <Dialog.Footer>
          {modalState === "idle" &&
            (assistant ? (
              startMode === "assist" ? (
                <AssistFooter
                  onGenerate={handleGenerate}
                  isGenerateDisabled={!description.trim()}
                  footerHint={footerHint}
                  assistant={assistant}
                />
              ) : (
                <ManualFooter onSkip={handleSkip} />
              )
            ) : (
              <IdleFooter
                onSkip={handleSkip}
                onGenerate={handleGenerate}
                isGenerateDisabled={!description.trim()}
                footerHint={footerHint}
              />
            ))}

          {modalState === "error" && (
            <ErrorFooter
              error={capturedError}
              onSkip={handleSkip}
              onTryAgain={handleTryAgain}
              assistant={assistant}
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

/**
 * The generic (no-assistant) idle body: a plain textarea + example pills. The
 * assistant surface renders its own compose block + inspiration chips inline in
 * the modal body instead, so this stays deliberately unbranded.
 */
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
      <Textarea
        placeholder={placeholder}
        value={description}
        onChange={onDescriptionChange}
        rows={5}
        resize="vertical"
      />

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

/**
 * The starting-point chips on the assisted path — Langy-flavoured inspiration
 * that fills the docked composer below. Kept out of the composer so the composer
 * stays a clean input the whole width of the dialog's bottom.
 */
function InspirationChips({
  assistantName,
  templates,
  onTemplate,
}: {
  assistantName: string;
  templates: ExampleTemplate[];
  onTemplate: (text: string) => void;
}) {
  if (templates.length === 0) return null;
  return (
    <Box>
      <Text fontSize="sm" color="fg.muted" mb={2}>
        Need inspiration? Pick a pattern and {assistantName} takes it from there.
      </Text>
      <HStack gap={2} flexWrap="wrap">
        {templates.map((template) => (
          <Button
            key={template.label}
            size="xs"
            variant="subtle"
            borderRadius="full"
            onClick={() => onTemplate(template.text)}
          >
            {template.label}
          </Button>
        ))}
      </HStack>
    </Box>
  );
}

/**
/**
 * Idle footer for the assistant path: the model hint on the left, the one warm
 * "Draft with {assistant}" action on the right — the same clean orange action
 * the inline `ScenarioAIGeneration` panel uses, so the two scenario-draft
 * surfaces read as one design.
 */
function AssistFooter({
  onGenerate,
  isGenerateDisabled,
  footerHint,
  assistant,
}: {
  onGenerate: () => void;
  isGenerateDisabled: boolean;
  footerHint?: React.ReactNode;
  assistant: AICreateAssistant;
}) {
  return (
    <HStack
      gap={2}
      width="full"
      justify={footerHint ? "space-between" : "flex-end"}
      align="center"
      flexWrap="wrap"
    >
      {footerHint}
      <Button
        colorPalette="orange"
        onClick={onGenerate}
        disabled={isGenerateDisabled}
        aria-label={`Generate with AI using ${assistant.name}`}
      >
        <Sparkles size={14} />
        {assistant.generateLabel ?? `Draft with ${assistant.name}`}
      </Button>
    </HStack>
  );
}

interface GeneratingStateProps {
  text: string;
  assistant?: AICreateAssistant;
}

function GeneratingState({ text, assistant }: GeneratingStateProps) {
  if (assistant) {
    return (
      <VStack gap={4} py={8} textAlign="center">
        <Box
          display="grid"
          placeItems="center"
          width="52px"
          height="52px"
          borderRadius="16px"
          borderWidth="1px"
          borderColor="border"
          bg="bg.surface"
          position="relative"
        >
          <LangyMark size={32} />
          <Spinner
            position="absolute"
            inset="-5px"
            width="60px"
            height="60px"
            borderWidth="2px"
            color="orange.400"
          />
        </Box>
        <VStack gap={1}>
          <Text fontWeight="semibold">{text}</Text>
          <Text color="fg.muted" fontSize="sm">
            {assistant.reviewHint ??
              "Nothing is saved yet — you will review and edit the draft first."}
          </Text>
        </VStack>
      </VStack>
    );
  }

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

/**
 * The generic (no-assistant) idle footer: a plain skip + generate pair. The
 * assistant surface renders `AssistFooter` (assist) or `ManualFooter` (manual)
 * instead, so this one no longer branches on `assistant`.
 */
interface IdleFooterProps {
  onSkip: () => void;
  onGenerate: () => void;
  isGenerateDisabled: boolean;
  footerHint?: React.ReactNode;
}

function IdleFooter({
  onSkip,
  onGenerate,
  isGenerateDisabled,
  footerHint,
}: IdleFooterProps) {
  return (
    <HStack
      gap={2}
      width="full"
      justify={footerHint ? "space-between" : "flex-end"}
      align="center"
      flexWrap="wrap"
    >
      {footerHint}
      <HStack gap={2}>
        <Button variant="ghost" onClick={onSkip}>
          I&apos;ll write it myself
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
    </HStack>
  );
}

/**
 * The two-path chooser at the top of the assistant idle body. It makes the
 * choice structural — the assistant is one option, "build it myself" is a
 * first-class peer sitting right beside it — so the modal never implies the
 * assistant is the only way through.
 */
function StartModeToggle({
  mode,
  onChange,
  assistantName,
}: {
  mode: "assist" | "manual";
  onChange: (mode: "assist" | "manual") => void;
  assistantName: string;
}) {
  return (
    <HStack
      gap={1}
      padding="3px"
      alignSelf="center"
      borderWidth="1px"
      borderColor="border"
      borderRadius="full"
      bg="bg.subtle"
    >
      <StartModeButton
        active={mode === "assist"}
        accent
        onClick={() => onChange("assist")}
      >
        <Sparkles size={13} />
        With {assistantName}
      </StartModeButton>
      <StartModeButton
        active={mode === "manual"}
        onClick={() => onChange("manual")}
      >
        <PencilLine size={13} />
        Build it myself
      </StartModeButton>
    </HStack>
  );
}

function StartModeButton({
  active,
  accent = false,
  onClick,
  children,
}: {
  active: boolean;
  /** The assistant tab lights the warm accent when active; manual stays neutral. */
  accent?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      display="inline-flex"
      alignItems="center"
      gap={1.5}
      paddingX={3.5}
      paddingY="7px"
      borderRadius="full"
      fontSize="sm"
      fontWeight="medium"
      whiteSpace="nowrap"
      cursor="pointer"
      transition="color 120ms ease, background 120ms ease, box-shadow 120ms ease"
      color={active ? (accent ? "orange.fg" : "fg") : "fg.muted"}
      bg={active ? "bg.surface" : "transparent"}
      boxShadow={active ? "0 1px 2px rgba(2, 6, 23, 0.12)" : "none"}
      _hover={active ? undefined : { color: "fg" }}
    >
      {children}
    </chakra.button>
  );
}

/** The manual path body: a plain, un-accented "you're in control" panel. */
function ManualStartState({ assistantName }: { assistantName: string }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      bg="bg.surface"
      padding={5}
    >
      <HStack align="start" gap={3}>
        <Box
          display="grid"
          placeItems="center"
          width="36px"
          height="36px"
          flexShrink={0}
          borderRadius="10px"
          borderWidth="1px"
          borderColor="border"
          bg="bg.subtle"
          color="fg.muted"
        >
          <PencilLine size={18} />
        </Box>
        <VStack align="start" gap={1}>
          <Text fontWeight="semibold">Build it yourself</Text>
          <Text color="fg.muted" fontSize="sm" lineHeight="tall">
            Open a blank scenario and write the situation and success criteria
            by hand — no model involved. You can hand it to {assistantName} for
            a draft at any point.
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}

/** Idle footer for the manual path: a single neutral "open the editor" action. */
function ManualFooter({ onSkip }: { onSkip: () => void }) {
  return (
    <HStack width="full" justify="flex-end">
      <Button colorPalette="gray" onClick={onSkip}>
        Open blank editor
        <ArrowRight size={14} />
      </Button>
    </HStack>
  );
}

interface ErrorFooterProps {
  error: unknown;
  onSkip: () => void;
  onTryAgain: () => void;
  assistant?: AICreateAssistant;
}

function ErrorFooter({
  error,
  onSkip,
  onTryAgain,
  assistant,
}: ErrorFooterProps) {
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
        {assistant ? "Set up manually" : "I'll write it myself"}
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
