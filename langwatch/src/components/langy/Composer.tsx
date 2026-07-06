import {
  Box,
  chakra,
  Flex,
  HStack,
  Separator,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { Send, Square } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { ModelSelector } from "~/components/ModelSelector";
import {
  AI_BG_SUBTLE,
  AI_BORDER,
  AI_SHADOW,
  MeshGradientLayer,
} from "~/features/traces-v2/components/ai/aiBrandVisuals";
import { useTypewriterPlaceholder } from "~/features/traces-v2/components/ai/useTypewriterPlaceholder";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";

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
}) {
  const filled = input.trim().length > 0;
  const [pickerExpanded, setPickerExpanded] = useState(false);
  const [pickerDropdownOpen, setPickerDropdownOpen] = useState(false);
  const typewriterPlaceholder = useTypewriterPlaceholder(
    !filled && !isBusy && !disabled,
    COMPOSER_PLACEHOLDER_EXAMPLES,
  );
  // Provider icon for the currently-selected model. Used by the collapsed
  // pill so we render a clean centered logo instead of clipping the full
  // ModelSelector trigger to 30px (which leaves the model name cut in half).
  // `null` during the cold-start window (model="" before resolvedDefault
  // lands) — used as a render gate below so we don't flash an empty pill.
  const collapsedProviderIcon = useMemo(() => {
    const providerKey = model.split("/")[0] ?? "";
    if (!providerKey) return null;
    return (
      modelProviderIcons[providerKey as keyof typeof modelProviderIcons] ?? null
    );
  }, [model]);
  const collapsePicker = () => {
    setPickerExpanded(false);
    setPickerDropdownOpen(false);
  };
  return (
    <>
      <Separator />
      <Box
        paddingX={3}
        paddingTop={3}
        paddingBottom={3}
        background="bg.surface"
        flexShrink={0}
      >
        {/* Per-send model picker. Collapsed to a small bubble showing just
            the provider logo; on hover/focus the bubble fluidly expands into
            the full picker. ModelSelector stays mounted — width animation
            reveals the model label + caret without a remount.

            Hidden via visibility (not unmounted) until the model resolves
            so we don't flash an empty 30px circle for the 50-300ms cold
            window before the resolved-default query lands. Reserving the
            slot keeps the composer from jumping. */}
        <Flex
          justifyContent="flex-end"
          marginBottom={1.5}
          data-testid="langy-model-picker"
          data-model={model}
          visibility={collapsedProviderIcon ? "visible" : "hidden"}
          aria-hidden={!collapsedProviderIcon}
          onMouseEnter={() => setPickerExpanded(true)}
          onMouseLeave={collapsePicker}
          onFocus={() => setPickerExpanded(true)}
          // Mirror onFocus: collapse when focus moves OUT of the wrapper —
          // BUT not when focus is moving into the Select's own portaled
          // popover (search input, option list). Those live as siblings of
          // <body>, not inside this wrapper, so the naive "is relatedTarget
          // a descendant?" check would close the dropdown the instant the
          // user opens it. Treat anything inside any `[data-scope="select"]`
          // subtree as still-within-the-picker for blur purposes.
          //
          // `relatedTarget` is `EventTarget | null` — narrow with `instanceof`
          // before calling Node/Element methods, since focus leaving to
          // browser chrome / another window can yield a non-Element target
          // that would throw on `.contains()`.
          onBlur={(e) => {
            const next = e.relatedTarget;
            if (!next) {
              collapsePicker();
              return;
            }
            if (next instanceof Node && e.currentTarget.contains(next)) return;
            if (
              next instanceof Element &&
              next.closest('[data-scope="select"]')
            )
              return;
            collapsePicker();
          }}
        >
          <Box
            position="relative"
            width={pickerExpanded ? "180px" : "30px"}
            height="28px"
            borderRadius="full"
            transition="width 220ms ease-out"
            transformOrigin="right center"
            _dark={{ "& svg path": { fill: "white" } }}
            cursor="pointer"
          >
            {/* Collapsed view: just the provider logo, centered, sized to
                match the icon the expanded ModelSelector renders so the
                logo doesn't visibly grow/shrink across the transition.
                Crossfade is short so the swap reads as a reveal, not a
                morph. */}
            <Flex
              position="absolute"
              inset={0}
              align="center"
              justify="center"
              opacity={pickerExpanded ? 0 : 1}
              transition="opacity 120ms ease-out"
              pointerEvents={pickerExpanded ? "none" : "auto"}
              aria-hidden={pickerExpanded}
            >
              <Box width="14px" height="14px" lineHeight={0}>
                {collapsedProviderIcon}
              </Box>
            </Flex>
            {/* Expanded view: full ModelSelector. Controlled open state so
                mouse-leave can close the dropdown alongside collapsing the
                pill — otherwise the popover floats orphaned. */}
            <Box
              position="absolute"
              inset={0}
              overflow="hidden"
              borderRadius="full"
              opacity={pickerExpanded ? 1 : 0}
              transition="opacity 200ms ease-out"
              pointerEvents={pickerExpanded ? "auto" : "none"}
              aria-hidden={!pickerExpanded}
            >
              <ModelSelector
                model={model}
                options={modelOptions}
                onChange={onModelChange}
                mode="chat"
                size="sm"
                open={pickerDropdownOpen}
                onOpenChange={setPickerDropdownOpen}
              />
            </Box>
          </Box>
        </Flex>
        <HStack
          gap={2}
          paddingY={1.5}
          paddingLeft={3}
          paddingRight={1.5}
          borderRadius="full"
          borderWidth="1px"
          borderStyle="solid"
          borderColor={filled ? AI_BORDER : "border.emphasized"}
          background="bg.surface"
          boxShadow={filled ? `0 0 0 3px ${AI_BG_SUBTLE}` : undefined}
          transition="border-color 150ms ease, box-shadow 150ms ease"
          align="center"
        >
          <Textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
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
            minHeight="22px"
            padding={0}
            border="none"
            background="transparent"
            textStyle="sm"
            lineHeight="1.45"
            color="fg"
            resize="none"
            _focus={{ outline: "none", boxShadow: "none" }}
            _focusVisible={{ outline: "none", boxShadow: "none" }}
          />
          {isBusy ? (
            <SendButton
              aria-label="Stop"
              onClick={onStop}
              background="var(--chakra-colors-red-solid)"
              color="white"
              shadow={false}
              cursor="pointer"
            >
              <Square size={12} />
            </SendButton>
          ) : (
            <SendButton
              aria-label="Send"
              onClick={onSend}
              disabled={!canSend}
              background={canSend ? "transparent" : "bg.muted"}
              color={canSend ? "white" : "fg.muted"}
              shadow={canSend}
              cursor={canSend ? "pointer" : "default"}
              meshOverlay={canSend}
            >
              <Send size={14} />
            </SendButton>
          )}
        </HStack>
        <Text
          marginTop={2}
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

function SendButton({
  children,
  background,
  color,
  shadow,
  cursor,
  meshOverlay = false,
  ...rest
}: {
  children: React.ReactNode;
  background: string;
  color: string;
  shadow: boolean;
  cursor: string;
  meshOverlay?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <chakra.button
      type="button"
      width="32px"
      height="32px"
      borderRadius="full"
      borderWidth={0}
      background={background}
      color={color}
      cursor={cursor}
      display="grid"
      placeItems="center"
      flexShrink={0}
      boxShadow={shadow ? AI_SHADOW : undefined}
      transition="background 150ms ease, box-shadow 150ms ease"
      position="relative"
      overflow="hidden"
      {...rest}
    >
      {meshOverlay && <MeshGradientLayer borderRadius="full" />}
      <Box position="relative" zIndex={1} display="grid" placeItems="center">
        {children}
      </Box>
    </chakra.button>
  );
}
