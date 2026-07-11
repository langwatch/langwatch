import { Box, chakra, HStack, Separator, Text, Textarea } from "@chakra-ui/react";
import {
  Database,
  FileText,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  Plus,
  Send,
  Square,
  Waypoints,
  X,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { ModelSelector } from "~/components/ModelSelector";
import { Menu } from "~/components/ui/menu";
import { useTypewriterPlaceholder } from "~/features/traces-v2/components/ai/useTypewriterPlaceholder";
import type { LangyContextChip } from "../stores/langyComposerStore";

// Icon per context kind, so a chip reads as its resource at a glance.
const CONTEXT_ICON: Record<LangyContextChip["kind"], LucideIcon> = {
  project: FolderKanban,
  experiment: FlaskConical,
  trace: Waypoints,
  prompt: FileText,
  dataset: Database,
  dashboard: LayoutDashboard,
  scenario: MessagesSquare,
};

const COMPOSER_PLACEHOLDER_EXAMPLES = [
  "Ask Langy or describe what you want…",
  "Try: which evaluators are failing most?",
  "Maybe: summarize today's runs",
  "How about: suggest an evaluator for hallucinations",
  "Like: compare last two experiment runs",
];

export function Composer({
  input,
  onInputChange,
  model,
  modelOptions,
  onModelChange,
  onSend,
  onStop,
  isBusy,
  disabled,
  canSend,
  contextChips = [],
  onRemoveChip,
  addableChips = [],
  onAddChip,
}: {
  input: string;
  onInputChange: (v: string) => void;
  /** The model Langy will use for the next send. "" = let the server pick. */
  model: string;
  /** Models the picker may offer (the VK allowlist, or all registry models). */
  modelOptions: string[];
  onModelChange: (model: string) => void;
  onSend: () => void;
  onStop: () => void;
  isBusy: boolean;
  disabled: boolean;
  canSend: boolean;
  /** Page context (experiment/trace) that rides as removable chips in-composer. */
  contextChips?: LangyContextChip[];
  onRemoveChip?: (id: string) => void;
  /** Dismissed context the "+ context" control can add back. */
  addableChips?: LangyContextChip[];
  onAddChip?: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const filled = input.trim().length > 0;
  const typewriterPlaceholder = useTypewriterPlaceholder(
    !filled && !isBusy && !disabled,
    COMPOSER_PLACEHOLDER_EXAMPLES,
  );

  return (
    <>
      <Separator />
      <Box paddingX={3.5} paddingY={3.5} background="bg.surface" flexShrink={0}>
        {/* One integrated surface. The field, the page-context chips, the
            model picker and send all live inside a single rounded card that
            lights up in the brand orange on focus — the composer reads as one
            object you are composing in, not three stacked controls. */}
        <Box
          borderWidth="1px"
          borderStyle="solid"
          borderColor={focused ? "orange.emphasized" : "border.emphasized"}
          borderRadius="18px"
          background="bg.subtle"
          boxShadow={
            focused ? "0 0 0 4px var(--chakra-colors-orange-subtle)" : undefined
          }
          transition="border-color 150ms ease, box-shadow 150ms ease"
          overflow="hidden"
        >
          {/* Page context rides as removable chips INSIDE the composer surface,
              above the input — so "opened this experiment / trace" is visible
              and dismissible right where you type. The "+ context" control adds
              back anything you dismissed. */}
          {contextChips.length > 0 || addableChips.length > 0 ? (
            <HStack gap={1.5} flexWrap="wrap" paddingX={3} paddingTop={3}>
              {contextChips.map((chip) => (
                <ContextChip
                  key={chip.id}
                  chip={chip}
                  onRemove={() => onRemoveChip?.(chip.id)}
                />
              ))}
              {addableChips.length > 0 ? (
                <ContextAddMenu
                  addableChips={addableChips}
                  onAddChip={onAddChip}
                />
              ) : null}
            </HStack>
          ) : null}

          <Textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isBusy && canSend) onSend();
              }
            }}
            placeholder={isBusy ? "Langy is working…" : typewriterPlaceholder}
            disabled={disabled || isBusy}
            rows={1}
            autoresize
            maxHeight="120px"
            minHeight="24px"
            paddingX={3.5}
            paddingTop={3}
            paddingBottom={1}
            border="none"
            background="transparent"
            textStyle="sm"
            lineHeight="1.5"
            color="fg"
            resize="none"
            _focus={{ outline: "none", boxShadow: "none" }}
            _focusVisible={{ outline: "none", boxShadow: "none" }}
          />

          {/* Bottom rail: the per-send model picker (left) and the send /
              stop control (right). Reuses the shared ModelSelector so the
              picker is identical to the prompts playground and evaluations. */}
          <HStack gap={2} paddingLeft={3} paddingRight={2} paddingY={2}>
            <Box
              data-testid="langy-model-picker"
              data-model={model}
              minWidth={0}
              _dark={{ "& svg path": { fill: "white" } }}
            >
              <ModelSelector
                model={model}
                options={modelOptions}
                onChange={onModelChange}
                mode="chat"
                size="sm"
              />
            </Box>
            {isBusy ? (
              <SendButton
                aria-label="Stop"
                onClick={onStop}
                background="red.solid"
                color="white"
              >
                <Square size={12} />
              </SendButton>
            ) : (
              <SendButton
                aria-label="Send"
                onClick={onSend}
                disabled={!canSend}
                background={canSend ? "orange.solid" : "bg.muted"}
                color={canSend ? "white" : "fg.muted"}
                cursor={canSend ? "pointer" : "default"}
              >
                <Send size={14} />
              </SendButton>
            )}
          </HStack>
        </Box>
        <Text
          marginTop={2.5}
          textStyle="2xs"
          color="fg.subtle"
          textAlign="center"
          letterSpacing="0.01em"
        >
          Langy proposes — you review and apply.
        </Text>
      </Box>
    </>
  );
}

function ContextChip({
  chip,
  onRemove,
}: {
  chip: LangyContextChip;
  onRemove: () => void;
}) {
  const Icon = CONTEXT_ICON[chip.kind] ?? Waypoints;
  return (
    <HStack
      gap={1}
      paddingLeft={2}
      paddingRight={1}
      paddingY={0.5}
      borderRadius="full"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="orange.emphasized"
      background="orange.subtle"
      maxWidth="100%"
    >
      <Box color="orange.fg" flexShrink={0}>
        <Icon size={11} />
      </Box>
      <Text textStyle="2xs" color="fg" truncate maxWidth="140px">
        {chip.label}
      </Text>
      <chakra.button
        type="button"
        aria-label={`Remove ${chip.label}`}
        onClick={onRemove}
        display="grid"
        placeItems="center"
        borderRadius="full"
        width="16px"
        height="16px"
        color="fg.muted"
        flexShrink={0}
        _hover={{ color: "fg", background: "bg.muted" }}
      >
        <X size={11} />
      </chakra.button>
    </HStack>
  );
}

/**
 * "+ context" control: a small pill that opens a menu of context the user
 * dismissed, so removed chips can be added back. Only rendered when there's
 * something to add (see the caller).
 */
function ContextAddMenu({
  addableChips,
  onAddChip,
}: {
  addableChips: LangyContextChip[];
  onAddChip?: (id: string) => void;
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger asChild>
        <chakra.button
          type="button"
          aria-label="Add context"
          display="inline-flex"
          alignItems="center"
          gap={1}
          paddingLeft={2}
          paddingRight={2.5}
          paddingY={0.5}
          borderRadius="full"
          borderWidth="1px"
          borderStyle="dashed"
          borderColor="border.emphasized"
          background="transparent"
          color="fg.muted"
          _hover={{ borderColor: "orange.emphasized", color: "fg" }}
        >
          <Plus size={11} />
          <Text textStyle="2xs">context</Text>
        </chakra.button>
      </Menu.Trigger>
      <Menu.Content minWidth="200px">
        {addableChips.map((chip) => {
          const Icon = CONTEXT_ICON[chip.kind] ?? Waypoints;
          return (
            <Menu.Item
              key={chip.id}
              value={chip.id}
              onClick={() => onAddChip?.(chip.id)}
            >
              <HStack gap={2}>
                <Box color="orange.fg" display="grid" placeItems="center">
                  <Icon size={12} />
                </Box>
                <Text textStyle="xs" truncate>
                  {chip.label}
                </Text>
              </HStack>
            </Menu.Item>
          );
        })}
      </Menu.Content>
    </Menu.Root>
  );
}

function SendButton({
  children,
  background,
  color,
  cursor = "pointer",
  ...rest
}: {
  children: React.ReactNode;
  background: string;
  color: string;
  cursor?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <chakra.button
      type="button"
      marginLeft="auto"
      width="34px"
      height="34px"
      borderRadius="full"
      borderWidth={0}
      background={background}
      color={color}
      cursor={cursor}
      display="grid"
      placeItems="center"
      flexShrink={0}
      transition="background 150ms ease"
      {...rest}
    >
      {children}
    </chakra.button>
  );
}
