import { Box, chakra, HStack, Text, Textarea } from "@chakra-ui/react";
import {
  Check,
  ChevronDown,
  ClipboardCheck,
  Database,
  FileText,
  Filter,
  FlaskConical,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  MessagesSquare,
  Paperclip,
  Plus,
  Send,
  Square,
  Waypoints,
} from "lucide-react";
import { memo, useRef, useState } from "react";
import type React from "react";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type { LangyRevealableKind } from "../stores/langyContextTargetStore";
import { describeChipContext } from "../logic/langyChipContext";
import { type LangyContextChip, useLangyStore } from "../stores/langyStore";
import { LangyComposerPalette, type PaletteMode } from "./LangyComposerPalette";
import { LangyModelPill } from "./LangyModelPill";

// The composer's corner. Lives here (not in the theme) because the sheen ring
// inherits it — one value, two places that must agree.
const COMPOSER_RADIUS = "18px";

// Icon per context kind, so a chip reads as its resource at a glance.
const CONTEXT_ICON: Record<LangyContextChip["kind"], LucideIcon> = {
  project: FolderKanban,
  experiment: FlaskConical,
  trace: Waypoints,
  prompt: FileText,
  dataset: Database,
  dashboard: LayoutDashboard,
  scenario: MessagesSquare,
  evaluation: ClipboardCheck,
  selection: ListChecks,
  filter: Filter,
};

// A single, static placeholder. A cycling typewriter here read as gimmicky and
// kept the composer visually busy; one calm prompt matches the reference and
// stays out of the way of what the person is trying to type.
const COMPOSER_PLACEHOLDER = "Ask Langy or describe what you want…";

/**
 * The composer rail — affordances that sit beside the model picker.
 *
 * Every entry here is a PLACEHOLDER: reasoning effort and attachments have no
 * backend behind them, so they render disabled rather than faked. This array is
 * the seam: when one gets wiring it grows an `onClick` and drops out of the
 * placeholder path, and the layout does not change to accommodate it.
 *
 * Skills are ambient agent capabilities, so they do not need a second,
 * user-managed control in the composer.
 */
function ComposerImpl({
  model,
  modelOptions,
  langyDefaultModel,
  onModelChange,
  onSend,
  onQueue,
  onStop,
  variant = "floating",
  isBusy,
  queuedCount = 0,
  disabled,
  contextChips = [],
  onRemoveChip,
  addableChips = [],
  onAddChip,
  onKindIntent,
  placeholder = COMPOSER_PLACEHOLDER,
}: {
  /** The model Langy will use for the next send. "" = let the server pick. */
  model: string;
  /** Models the picker may offer (the VK allowlist, or all registry models). */
  modelOptions: string[];
  /** Model selected by the project's Langy routing configuration. */
  langyDefaultModel?: string | null;
  onModelChange: (model: string) => void;
  onSend: (input: string) => void;
  /** Accept the next message while the current turn is still running. */
  onQueue?: (input: string) => void;
  onStop: () => void;
  /** Floating is a card; sidebar is already bounded and stays deliberately flat. */
  variant?: "floating" | "sidebar";
  isBusy: boolean;
  queuedCount?: number;
  disabled: boolean;
  /** Page context (experiment/trace) that rides as removable chips in-composer. */
  contextChips?: LangyContextChip[];
  onRemoveChip?: (id: string) => void;
  /** Dismissed context the "+ context" control can add back. */
  addableChips?: LangyContextChip[];
  onAddChip?: (id: string) => void;
  /** `#trace`-style asks in the palette: reveal on this page, or go browse. */
  onKindIntent?: (intent: {
    kind: LangyRevealableKind;
    action: "reveal" | "browse";
  }) => void;
  placeholder?: string;
}) {
  const floating = variant === "floating";
  const [focused, setFocused] = useState(false);
  const reduceMotion = useReducedMotion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Keep the hot keystroke subscription at the leaf. When LangyPanel itself
  // subscribed to `draft`, every character rebuilt the whole conversation,
  // capability cards, context derivation, and wave. On large trace pages that
  // was enough main-thread work to look like a page reload.
  const input = useLangyStore((s) => s.draft);
  const onInputChange = useLangyStore((s) => s.setDraft);
  const canSend = !!input.trim() && !isBusy && !disabled;

  // The rainbow sheen is an INVITATION on a blank composer — it belongs to the
  // empty, idle state, where it reads as "start here". The moment the
  // conversation has anything in it — a turn in flight, or a conversation with
  // history/messages already adopted — the sheen would only compete with the
  // answer, so it drops. `activeConversationId` is non-null once the server
  // adopts a fresh turn or the user loads a conversation; `isBusy` covers the
  // instant between the first send and that adoption. Either means the
  // conversation has started, so the sheen goes.
  const activeConversationId = useLangyStore((s) => s.activeConversationId);
  const conversationStarted = activeConversationId !== null || isBusy;

  /**
   * `#` summons context. Skills are ambient agent capabilities and do not need
   * a second, user-managed representation in the composer.
   *
   * The trigger key is NEVER inserted into the draft — we intercept it on
   * keydown and open the palette instead. That is why there is no "strip the
   * token" step anywhere in this file: there is no token.
   *
   * Only fires at a word boundary (start of the message, or after whitespace),
   * so a URL's `https://` and a `#tag` mid-sentence are left alone.
   */
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");

  const closePalette = () => {
    setPalette(null);
    setPaletteQuery("");
    // Give the message back its cursor — the palette was a detour, not a
    // destination.
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const atWordBoundary = () => {
    const el = textareaRef.current;
    if (!el) return input.length === 0;
    const before = input.slice(0, el.selectionStart ?? input.length);
    return before.length === 0 || /\s$/.test(before);
  };

  const onTextareaKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "#" && atWordBoundary()) {
      event.preventDefault();
      setPaletteQuery("");
      setPalette("context");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isBusy && input.trim()) onQueue?.(input);
      else if (canSend) onSend(input);
    }
  };

  return (
    // Tight at the bottom: the caption is a whisper under the input, not a
    // floor. The old symmetric 3.5 padding left a dead band below it that ate
    // vertical space the (now taller) panel would rather give to the answer.
    <Box
      // Both layouts wear the rounded, shadowed card — sidebar included — and
      // BOTH inset it by the same generous gutter, so the docked card doesn't
      // read as tighter or more squashed than the floating one.
      paddingX={3.5}
      paddingTop={3}
      paddingBottom={floating ? 2 : 3.5}
      // Transparent in BOTH layouts: the footer is a sibling BELOW the scroller
      // (its content can't bleed past it), so a solid backing bought nothing and
      // only painted a grey box around the card. Transparent lets the panel
      // surface + fold show around the floating card exactly as in the floating
      // layout — one language, two docks.
      background="transparent"
      flexShrink={0}
      css={{
        "@media (max-height: 520px)": {
          paddingTop: "8px",
          paddingBottom: "8px",
        },
      }}
    >
      {/* While Langy is working the whole composer SINKS a few pixels and
          settles — a listening posture, not a bounce (long ease-out, no
          overshoot). The wrapper owns the transform, and the radius the sheen
          ring inherits.

          The travelling rainbow sheen is a SEPARATE signal: it rides the border
          only while the conversation is still empty and idle — the inviting
          "start a chat" state — and drops the moment the first message or
          streamed element arrives. See `conversationStarted` above. */}
      <Box
        position="relative"
        borderRadius={COMPOSER_RADIUS}
        transform={
          isBusy && !reduceMotion ? "translateY(3px)" : "translateY(0)"
        }
        transition="transform 380ms cubic-bezier(0.32, 0.72, 0, 1)"
      >
        {!conversationStarted ? (
          <Box className="langy-composer-sheen" aria-hidden />
        ) : null}
        {/* One integrated surface. The field, the page-context chips, the
            model picker and send all live inside a single rounded card that
            lights up in the brand orange on focus — the composer reads as one
            object you are composing in, not three stacked controls. */}
        <Box
          borderWidth="1px"
          borderStyle="solid"
          borderColor={focused ? "orange.emphasized" : "border.emphasized"}
          borderRadius={COMPOSER_RADIUS}
          background="bg.subtle"
          // Focus swaps in the brand-orange ring in both layouts. At rest the
          // floating card leans on the panel it overlays (no shadow, as before),
          // while the sidebar card grows its own drop shadow so it lifts off the
          // flat dock instead of reading as a bar welded to the bottom.
          boxShadow={
            focused
              ? "0 0 0 4px var(--chakra-colors-orange-subtle)"
              : floating
                ? undefined
                : "0 1px 2px rgba(0, 0, 0, 0.06), 0 6px 16px -6px rgba(0, 0, 0, 0.14)"
          }
          transition="border-color 150ms ease, box-shadow 150ms ease"
          overflow="hidden"
        >
          {/* `#` turns the top of the card into a real combobox. It is
              the SAME rounded surface — the composer becomes a command bar
              rather than sprouting a popup beside one. */}
          {palette ? (
            <LangyComposerPalette
              mode={palette}
              query={paletteQuery}
              chips={contextChips}
              onQueryChange={setPaletteQuery}
              onPickChip={(id) => {
                // `#` on a chip that is already attached is a no-op that still
                // reads as success — the user asked for it to be there, and it
                // is. `onAddChip` restores it if they had dismissed it.
                onAddChip?.(id);
                closePalette();
              }}
              onKindIntent={onKindIntent}
              onClose={closePalette}
            />
          ) : null}

          <ContextSummaryMenu
            contextChips={contextChips}
            addableChips={addableChips}
            onRemoveChip={onRemoveChip}
            onAddChip={onAddChip}
            compact={!floating}
          />

          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onTextareaKeyDown}
            placeholder={isBusy ? "Write your next message…" : placeholder}
            disabled={disabled}
            rows={1}
            autoresize
            maxHeight="120px"
            minHeight="20px"
            paddingX={3}
            paddingTop={2.5}
            paddingBottom={0.5}
            border="none"
            background="transparent"
            // Denser than the panel's body scale: the composer is a control, not
            // reading matter, and a wider panel made 14px input read shouty.
            fontSize="sm"
            lineHeight="1.5"
            color="fg"
            resize="none"
            // Block (not the default inline-block) so the textarea has no
            // baseline descender gap under it — that phantom ~5px was the
            // "dead band" between the placeholder and the model/send rail.
            display="block"
            _focus={{ outline: "none", boxShadow: "none" }}
            _focusVisible={{ outline: "none", boxShadow: "none" }}
          />

          {/* Bottom rail: the per-send model picker and a row of composer
              affordances on the left, send / stop on the right.

              The rail is built to GROW — one primitive, one array — but it only
              ever shows what is real. Effort and file attachments have no
              wiring behind them today, so they render as explicitly disabled
              placeholders rather than buttons that lie: a greyed glyph with a
              "Coming soon" tooltip, quiet enough that they never compete with
              Send. Page context is NOT here — it already has a better home as
              the chips above the input, where you can see what's attached. */}
          <HStack
            gap={1}
            paddingLeft={2.5}
            paddingRight={2}
            paddingBottom={2}
            paddingTop={1}
          >
            <LangyModelPill
              model={model}
              options={modelOptions}
              langyDefaultModel={langyDefaultModel}
              onChange={onModelChange}
              // The model is locked in the moment a turn starts — it rode with
              // the send and can't change mid-flight — so the picker greys out
              // until the turn settles rather than offering a choice that
              // wouldn't take.
              disabled={disabled || isBusy}
            />
            <RailButton icon={Gauge} label="Reasoning effort" />
            <RailButton icon={Paperclip} label="Attach a file" />
            {/* The only discoverability the palette gets, and all it needs. It
                fades out the moment the composer is in use, so it is a hint on
                an empty field rather than a permanent label. */}
            {isBusy ? (
              <>
                {queuedCount > 0 ? (
                  <Text marginLeft="auto" textStyle="2xs" color="fg.muted">
                    {queuedCount} queued
                  </Text>
                ) : null}
                <SendButton
                  aria-label="Stop"
                  onClick={onStop}
                  background="red.solid"
                  color="white"
                >
                  <Square size={12} />
                </SendButton>
              </>
            ) : (
              <SendButton
                aria-label="Send"
                onClick={() => onSend(input)}
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
      </Box>
      {floating ? (
        <Text
          marginTop={1.5}
          textStyle="2xs"
          color="fg.subtle"
          textAlign="center"
          letterSpacing="0.01em"
          lineHeight="1.2"
          css={{
            "@media (max-height: 520px)": { display: "none" },
          }}
        >
          Langy proposes — you review and apply.
        </Text>
      ) : null}
    </Box>
  );
}

export const Composer = memo(ComposerImpl);
Composer.displayName = "Composer";

/**
 * One rail affordance. Disabled on purpose — see COMPOSER_RAIL. It keeps the
 * button semantics (and stays in the tab order via `aria-disabled` rather than
 * `disabled`, so it is discoverable and its tooltip is reachable) but does
 * nothing, and it says so.
 */
function RailButton({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Tooltip content={`${label} — coming soon`} openDelay={300} showArrow>
      <chakra.button
        type="button"
        aria-label={`${label} (coming soon)`}
        aria-disabled
        onClick={(event) => event.preventDefault()}
        display="grid"
        placeItems="center"
        width="26px"
        height="26px"
        borderRadius="full"
        borderWidth={0}
        background="transparent"
        color="fg.subtle"
        opacity={0.45}
        cursor="not-allowed"
        flexShrink={0}
      >
        <Icon size={14} />
      </chakra.button>
    </Tooltip>
  );
}

/** One quiet summary replaces the old wrapping pile of context chips. */
function ContextSummaryMenu({
  contextChips,
  addableChips,
  onRemoveChip,
  onAddChip,
  compact,
}: {
  contextChips: LangyContextChip[];
  addableChips: LangyContextChip[];
  onRemoveChip?: (id: string) => void;
  onAddChip?: (id: string) => void;
  compact: boolean;
}) {
  const primary = contextChips[0];
  const extra = Math.max(0, contextChips.length - 1);

  return (
    <Menu.Root positioning={{ placement: "top-start", gutter: 6 }}>
      <Menu.Trigger asChild>
        <chakra.button
          type="button"
          aria-label={`Context: ${contextChips.length} included`}
          display="inline-flex"
          alignItems="center"
          gap={1.5}
          marginX={3}
          marginTop={compact ? 2 : 2.5}
          paddingX={2}
          paddingY={1}
          maxWidth="calc(100% - 24px)"
          borderRadius="md"
          borderWidth="1px"
          borderStyle="solid"
          borderColor="border.muted"
          background="bg.muted/55"
          color="fg.muted"
          _hover={{ borderColor: "border.emphasized", color: "fg" }}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: "orange.focusRing",
          }}
        >
          <Waypoints size={12} />
          <Text textStyle="2xs" fontWeight="medium" color="fg.muted">
            Context
          </Text>
          <Text textStyle="2xs" color="fg" truncate>
            {primary?.label ?? "Choose what Langy can see"}
          </Text>
          {extra > 0 ? (
            <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
              +{extra}
            </Text>
          ) : null}
          <ChevronDown size={11} />
        </chakra.button>
      </Menu.Trigger>
      <Menu.Content minWidth="300px" maxWidth="360px" padding={1}>
        {contextChips.length === 0 && addableChips.length === 0 ? (
          <Text padding={3} textStyle="xs" color="fg.muted">
            Langy can use the trace, evaluation, dataset, or feature you&apos;re
            looking at. Open one to make it available here.
          </Text>
        ) : null}
        {contextChips.length > 0 ? (
          <Menu.ItemGroup title="Included from your current view">
            {contextChips.map((chip) => {
              const Icon = CONTEXT_ICON[chip.kind] ?? Waypoints;
              const explanation = describeChipContext(chip);
              return (
                <Menu.Item
                  key={chip.id}
                  value={`remove:${chip.id}`}
                  onClick={() => onRemoveChip?.(chip.id)}
                  aria-label={`Remove ${chip.label} from context`}
                  paddingY={2}
                >
                  <HStack gap={2.5} width="full" align="start">
                    <Box color="orange.fg" display="grid" paddingTop="2px">
                      <Icon size={13} />
                    </Box>
                    <Box minWidth={0} flex={1}>
                      <Text textStyle="xs" fontWeight="medium" truncate>
                        {chip.label}
                      </Text>
                      <Text textStyle="2xs" color="fg.subtle" lineClamp={2}>
                        {explanation.action}
                      </Text>
                    </Box>
                    <Check size={12} />
                  </HStack>
                </Menu.Item>
              );
            })}
          </Menu.ItemGroup>
        ) : null}
        {contextChips.length > 0 && addableChips.length > 0 ? (
          <Menu.Separator />
        ) : null}
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
                <Plus size={12} />
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
