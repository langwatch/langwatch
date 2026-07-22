import { Box, chakra, HStack, Spinner, Text, Textarea } from "@chakra-ui/react";
import {
  Bot,
  Check,
  ChevronDown,
  ClipboardCheck,
  Database,
  FileText,
  Filter,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  MessageSquareQuote,
  MessagesSquare,
  Plus,
  Send,
  Sparkles,
  Square,
  Waypoints,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useRef, useState } from "react";
import type React from "react";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type { LangySkill } from "~/shared/langy/langySkills";
import {
  type LangyRevealableKind,
  useLangyContextTargetStore,
} from "../stores/langyContextTargetStore";
import { describeChipContext } from "../logic/langyChipContext";
import { type LangyContextChip, useLangyStore } from "../stores/langyStore";
import { LangyComposerPalette, type PaletteMode } from "./LangyComposerPalette";
import { LangyModelPill } from "./LangyModelPill";

// The composer's corner. Lives here (not in the theme) because the sheen ring
// inherits it — one value, two places that must agree. It is also what sells
// the home page's send as one object moving: the travelling copy holds this
// exact radius from the home page to the panel's floor, so DO NOT vary it per
// variant.
const COMPOSER_RADIUS = "18px";

/**
 * Marks the composer's outer card in the DOM so a surface OUTSIDE the panel can
 * measure where it is going to land.
 *
 * The home page's send animates a copy of its own composer to the panel's, and
 * the panel is mounted in a different tree behind a `position: fixed` boundary,
 * so there is no ref to pass. An attribute is the seam: one selector, no
 * plumbing through three components, and nothing breaks if the reader is not on
 * the home page. The value distinguishes the panel's composer (the destination)
 * from the home page's own (the origin).
 */
export const COMPOSER_ANCHOR_ATTR = "data-langy-composer";

// The send/stop control crossfades between phases (send ⇄ stop ⇄ stopping)
// rather than hard-swapping — a small scale+fade keyed on the phase.
const MotionSwap = motion.create(Box);

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
  workflow: Workflow,
  agent: Bot,
  automation: Zap,
  annotation: MessageSquareQuote,
};

// A single, static placeholder. A cycling typewriter here read as gimmicky and
// kept the composer visually busy; one calm prompt matches the reference and
// stays out of the way of what the person is trying to type.
const COMPOSER_PLACEHOLDER = "Ask Langy or describe what you want…";

/**
 * The composer rail — affordances that sit beside the model picker.
 *
 * The rail carries only REAL controls. Three buttons used to sit here and are
 * gone, for the same reason in three directions. "Skills" went because they
 * became REAL — a catalogue, a chip, and a `/` to summon them — and a dead
 * button beside a live feature teaches people that the buttons are decoration.
 * "Attach a file" went because it is NOT coming: there is no upload path at any
 * layer (no write endpoint, no field on the turn, no way to get bytes to the
 * worker), so a greyed paperclip was advertising a feature with nothing behind
 * it and no plan to build it. "Reasoning effort" went last: it sat as a greyed
 * "coming soon" placeholder with no backend behind it, and a placeholder is a
 * promise; an indefinite one is a lie.
 */
function ComposerImpl({
  model,
  modelOptions,
  langyDefaultModel,
  onModelChange,
  onSend,
  onStop,
  variant = "floating",
  disabled,
  contextChips = [],
  onRemoveChip,
  addableChips = [],
  onAddChip,
  onKindIntent,
  placeholder = COMPOSER_PLACEHOLDER,
  cardRef,
}: {
  /** The model Langy will use for the next send. "" = let the server pick. */
  model: string;
  /** Models the picker may offer (the VK allowlist, or all registry models). */
  modelOptions: string[];
  /** Model selected by the project's Langy routing configuration. */
  langyDefaultModel?: string | null;
  onModelChange: (model: string) => void;
  onSend: (input: string) => void;
  /** Stop the in-flight turn (the panel owns the real backend stop, ADR-058). */
  onStop: () => void;
  /**
   * Floating is a card; sidebar is already bounded and stays deliberately
   * flat; hero is the home page's, sitting on glass over a moving canvas.
   */
  variant?: "floating" | "sidebar" | "hero";
  disabled: boolean;
  /**
   * Hero only. A ref onto the composer's outer card, so the home page can
   * measure where its send starts from. The panel's own composer is found by
   * `COMPOSER_ANCHOR_ATTR` instead — it lives in another tree.
   */
  cardRef?: React.RefObject<HTMLDivElement | null>;
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
  const hero = variant === "hero";
  const [focused, setFocused] = useState(false);
  // Only the hero cares: it centres its single line, and has to stop doing so
  // the moment the field grows, or the send button ends up halfway down a
  // paragraph. Measured from the field itself rather than guessed from the
  // text's length, which would be wrong at every width.
  const [multiline, setMultiline] = useState(false);
  const reduceMotion = useReducedMotion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Keep the hot keystroke subscription at the leaf. When LangyPanel itself
  // subscribed to `draft`, every character rebuilt the whole conversation,
  // capability cards, context derivation, and wave. On large trace pages that
  // was enough main-thread work to look like a page reload.
  const input = useLangyStore((s) => s.draft);
  const onInputChange = useLangyStore((s) => s.setDraft);
  // The turn phase is the SINGLE source for the send/stop affordance (ADR-058):
  // `idle` lets the composer send; `active`/`stopping` disable sending and show
  // Stop. Gating on the durable phase — not the client stream's flaky isBusy —
  // is what stops a second send slipping through the instant the first token
  // arrives and 409-ing the in-flight turn. You can still TYPE the next message.
  const turnPhase = useLangyStore((s) => s.turnPhase);
  const turnActive = turnPhase !== "idle";

  // The one-time gesture hint. Both selectors return booleans, so the target
  // registry's churn (rows mounting as a table scrolls) re-renders the composer
  // only on the single transition from "nothing to point at" to "something".
  const contextHintDismissed = useLangyStore((s) => s.contextHintDismissed);
  const dismissContextHint = useLangyStore((s) => s.dismissContextHint);
  const pageHasTargets = useLangyContextTargetStore(
    (s) => Object.keys(s.targets).length > 0,
  );
  const showGestureHint = !contextHintDismissed && pageHasTargets;
  const canSend = turnPhase === "idle" && !!input.trim() && !disabled;

  // The rainbow sheen is an ACTIVITY signal, not an invitation. It used to ride
  // the border only while the composer was blank and idle ("start here") and
  // drop the instant you sent — which meant the one moment the composer had
  // something to say about itself was the one moment it said nothing. Now it is
  // lit for exactly as long as a turn is in flight (including the `stopping`
  // window), so the ring travelling round the composer means "Langy is working".
  // It pairs with the 3px sink below: same trigger, same phase, one posture.

  /**
   * Two keys, two palettes, and the split is the whole point: `#` summons
   * CONTEXT (the things on this page Langy could be given), `/` summons SKILLS
   * (the things Langy knows how to do). One is nouns, the other verbs.
   *
   * The trigger key is NEVER inserted into the draft — we intercept it on
   * keydown and open the palette instead. That is why there is no "strip the
   * token" step anywhere in this file: there is no token. A half-typed `/git`
   * cannot leak into a prompt because it never lived in the textarea.
   *
   * Only fires at a word boundary (start of the message, or after whitespace),
   * so a URL's `https://` and a `#tag` mid-sentence are left alone.
   */
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");

  const openPalette = (mode: PaletteMode) => {
    setPaletteQuery("");
    setPalette(mode);
  };

  /**
   * A picked skill becomes a real, editable message rather than a token.
   *
   * A skill declares the question it answers (`userPrompt` in its own
   * SKILL.md); dropping that into the draft leaves the user with something they
   * can read, edit and send. The alternative — inserting `/tracing` and hoping
   * — asks them to finish a sentence in a syntax nobody documented. Client
   * commands are the exception: `/feedback` IS the message the composer
   * intercepts, so it goes in verbatim.
   */
  const pickSkill = (skill: LangySkill) => {
    const text =
      skill.source === "client-command"
        ? `/${skill.id}`
        : (skill.prompt ?? `Use the ${skill.label} skill: `);
    const existing = input.trim();
    onInputChange(existing ? `${existing}\n\n${text}` : text);
  };

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
      openPalette("context");
      return;
    }
    if (event.key === "/" && atWordBoundary()) {
      event.preventDefault();
      openPalette("skills");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // No queue: Enter is a no-op mid-turn (canSend is false while a turn is in
      // flight), so nothing is sent until the turn finishes.
      if (canSend) onSend(input);
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
      paddingX={hero ? 0 : 3.5}
      paddingTop={hero ? 0 : 3}
      paddingBottom={hero ? 0 : floating ? 2 : 3.5}
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

          The travelling rainbow sheen rides the same trigger: lit while a turn
          is in flight, dark at rest. See the note on `turnActive` above. */}
      {showGestureHint ? (
        <ContextGestureHint onDismiss={dismissContextHint} />
      ) : null}
      <Box
        position="relative"
        borderRadius={COMPOSER_RADIUS}
        transform={
          turnActive && !reduceMotion ? "translateY(3px)" : "translateY(0)"
        }
        transition="transform 380ms cubic-bezier(0.32, 0.72, 0, 1)"
      >
        {turnActive ? (
          <Box className="langy-composer-sheen" aria-hidden />
        ) : null}
        {/* One integrated surface. The field, the page-context chips, the
            model picker and send all live inside a single rounded card that
            lights up in the brand orange on focus — the composer reads as one
            object you are composing in, not three stacked controls. */}
        <Box
          ref={hero ? cardRef : undefined}
          // The seam the home page's send measures against. Present on every
          // variant so the panel's composer (`panel`) is findable from outside
          // the panel's tree, and the home page's own (`hero`) is never
          // mistaken for it.
          {...{ [COMPOSER_ANCHOR_ATTR]: hero ? "hero" : "panel" }}
          borderWidth="1px"
          borderStyle="solid"
          borderColor={focused ? "orange.emphasized" : "border.emphasized"}
          borderRadius={COMPOSER_RADIUS}
          // Hero sits on GLASS. It is the only variant with a moving canvas
          // behind it, so an opaque fill would punch a hole in the block it is
          // set into; a blurred, mostly-opaque surface keeps the text crisp
          // while the light still reads through the edges.
          background={hero ? "bg.panel/88" : "bg.subtle"}
          backdropFilter={hero ? "blur(8px)" : undefined}
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
          {/* `/` or `#` turns the top of the card into a real combobox. It is
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
              onPickSkill={pickSkill}
              onKindIntent={onKindIntent}
              onClose={closePalette}
            />
          ) : null}

          {/* The hero is deliberately barer than the panel's two. It is the
              first thing a reader meets on their home page, sitting over a
              moving canvas, and a context summary plus a model picker plus a
              sigil rail is a great deal of chrome to meet before you have
              typed anything. Everything it drops is one click away the moment
              the panel opens, on the same conversation. */}
          {hero ? null : (
            <ContextSummaryMenu
              contextChips={contextChips}
              addableChips={addableChips}
              onRemoveChip={onRemoveChip}
              onAddChip={onAddChip}
              compact={!floating}
            />
          )}

          {/* The input row: the field, and send / stop DIRECTLY BESIDE IT.
              The control used to live on the bottom rail with the model picker,
              which put two unrelated things — "what model runs this" and "run
              it" — on one line and left the input floating above them both.
              Beside the field it reads as the field's own action.

              `align="flex-end"` so the button stays pinned to the bottom of a
              growing textarea (autoresize climbs to 120px) rather than drifting
              down with the vertical centre.

              The HERO is the exception, and it has to be. In the panel this row
              sits between a context summary above and the model rail below,
              which is what gives the field its vertical bearings; the hero
              shows neither, so the row IS the bar. Bottom-aligned against
              nothing, the text rode high and the send button hung off the
              floor. Centred, with symmetric padding, the placeholder and the
              button share one optical centre line. It still flips to bottom
              alignment once the field has grown past a single line, so a long
              question does not drag the button down the middle of it. */}
          <HStack
            gap={1.5}
            align={hero && !multiline ? "center" : "flex-end"}
            paddingRight={hero ? "7px" : 2}
            paddingLeft={hero ? "5px" : 0}
            paddingY={hero ? "7px" : 0}
            paddingBottom={hero ? "7px" : 1}
          >
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                onInputChange(e.target.value);
                if (hero) setMultiline(e.target.scrollHeight > 30);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={onTextareaKeyDown}
              placeholder={
                turnActive ? "Write your next message…" : placeholder
              }
              disabled={disabled}
              rows={1}
              autoresize
              maxHeight="120px"
              minHeight="20px"
              flex={1}
              minWidth={0}
              paddingX={3}
              // Symmetric in the hero so the single line sits on the row's
              // centre; the panel keeps its asymmetric pair, which is tuned to
              // the rail sitting directly underneath it.
              paddingTop={hero ? 0 : 2.5}
              paddingBottom={hero ? 0 : 0.5}
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
              // "dead band" between the placeholder and the model rail.
              display="block"
              _focus={{ outline: "none", boxShadow: "none" }}
              _focusVisible={{ outline: "none", boxShadow: "none" }}
            />
            {/* A turn in flight disables sending — Stop takes the button (no
                queue). It persists through the "stopping" window (after the
                client abort) until the backend confirms the terminal, then flips
                back to Send. */}
            <AnimatePresence mode="wait" initial={false}>
              <MotionSwap
                key={turnPhase}
                display="flex"
                flexShrink={0}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }
                }
                transition={{ duration: 0.13, ease: "easeOut" }}
              >
                {turnActive ? (
                  <SendButton
                    aria-label={turnPhase === "stopping" ? "Stopping" : "Stop"}
                    onClick={onStop}
                    disabled={turnPhase === "stopping"}
                    background={
                      turnPhase === "stopping" ? "bg.muted" : "red.solid"
                    }
                    color={turnPhase === "stopping" ? "fg.muted" : "white"}
                    cursor={turnPhase === "stopping" ? "default" : "pointer"}
                  >
                    {turnPhase === "stopping" ? (
                      <Spinner size="xs" borderWidth="1.5px" />
                    ) : (
                      // The square is symmetric, so it needs no optical
                      // correction — unlike the plane below.
                      <Square size={12} />
                    )}
                  </SendButton>
                ) : (
                  <SendButton
                    aria-label="Send"
                    onClick={() => onSend(input)}
                    disabled={!canSend}
                    background={canSend ? "orange.solid" : "bg.muted"}
                    color={canSend ? "white" : "fg.muted"}
                    cursor={canSend ? "pointer" : "default"}
                  >
                    {/* OPTICAL centring, not geometric. Lucide's paper plane is
                        very nearly centred in its own box (ink centre is within
                        0.15 of the 24-grid centre), so `place-items: center`
                        already puts it dead centre — and it still reads low and
                        left, because the glyph's visual mass is the wide tail
                        while the tip runs off to the top right. Nudging it a
                        pixel along its own axis is what makes it LOOK centred in
                        a circle. Sub-pixel values don't survive rasterisation,
                        hence a whole pixel each way. */}
                    <Box
                      display="grid"
                      placeItems="center"
                      transform="translate(1px, -1px)"
                    >
                      <Send size={14} />
                    </Box>
                  </SendButton>
                )}
              </MotionSwap>
            </AnimatePresence>
          </HStack>

          {/* Bottom rail: the per-send model picker and the composer
              affordances. Send is NOT here any more — it sits beside the input
              above, where the thing it acts on is.

              The rail only ever shows what is real — see COMPOSER_RAIL above.
              Page context is NOT here — it already has a better home as the
              chips above the input, where you can see what's attached. */}
          <HStack
            gap={1}
            // ONE row, centers on one line: the model pill (28px control) and
            // the sigil buttons share the rail, so the sigils carry the same
            // control height (see SigilButton) and the row centers explicitly
            // rather than by luck.
            align="center"
            paddingLeft={2.5}
            paddingRight={2}
            paddingBottom={2}
            paddingTop={0}
            // See the note on the context summary above: the hero stays bare.
            display={hero ? "none" : undefined}
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
              disabled={disabled || turnActive}
            />
            <Box flex={1} />
            {/* The two keys, said out loud. A palette you can only reach by
                guessing a keystroke is a palette most people never see, so the
                sigils sit on the rail as real buttons: they name what each key
                opens AND open it, which means the shortcut teaches itself the
                first time someone clicks one. */}
            <SigilButton
              sigil="#"
              label="Context"
              hint="Add something from this page. Press #"
              onClick={() => openPalette("context")}
            />
            <SigilButton
              sigil="/"
              label="Skills"
              hint="Pick what Langy should do. Press /"
              onClick={() => openPalette("skills")}
            />
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
          {/* House style rules out the em dash anywhere in user-facing copy
              (dev/docs/best_practices/copywriting.md). */}
          Langy proposes, you review and apply.
        </Text>
      ) : null}
    </Box>
  );
}

export const Composer = memo(ComposerImpl);
Composer.displayName = "Composer";

/**
 * A key, named. Deliberately shows the glyph rather than an icon: the point of
 * the control is to teach the keystroke, and an icon teaches nothing about
 * which key to press.
 */
function SigilButton({
  sigil,
  label,
  hint,
  onClick,
}: {
  sigil: string;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={hint} openDelay={300} showArrow>
      <chakra.button
        type="button"
        aria-label={hint}
        onClick={onClick}
        display="inline-flex"
        alignItems="center"
        gap={1}
        // The model pill's control height, so the rail's controls share one
        // vertical center instead of a 22px button hanging beside a 28px pill.
        height="28px"
        paddingLeft={1}
        paddingRight={1.5}
        borderRadius="md"
        borderWidth={0}
        background="transparent"
        color="fg.subtle"
        cursor="pointer"
        flexShrink={0}
        _hover={{ background: "bg.muted", color: "fg" }}
      >
        <chakra.span
          display="grid"
          placeItems="center"
          minWidth="15px"
          height="15px"
          borderRadius="sm"
          borderWidth="1px"
          borderStyle="solid"
          borderColor="border.emphasized"
          fontFamily="mono"
          fontSize="10px"
          lineHeight="1"
        >
          {sigil}
        </chakra.span>
        <Text textStyle="2xs">{label}</Text>
      </chakra.button>
    </Tooltip>
  );
}

/**
 * The one-time teaching line for "you can hand me things off the page".
 *
 * It appears the first time there is actually something on the page to hand
 * over — a hint on a page with nothing to point at would be teaching a gesture
 * that does nothing — and it goes away for good the moment the user dismisses
 * it OR does the thing (see `absorbContextTarget`). One showing, then silence.
 */
function ContextGestureHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <HStack
      gap={2}
      align="start"
      marginBottom={2}
      paddingX={2.5}
      paddingY={1.5}
      borderRadius="lg"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="orange.subtle"
      background="orange.subtle/40"
      data-testid="langy-context-gesture-hint"
    >
      <Box color="orange.fg" display="grid" paddingTop="2px" flexShrink={0}>
        <Sparkles size={12} />
      </Box>
      <Text textStyle="2xs" color="fg.muted" flex={1} minWidth={0}>
        Anything on this page can come along. Press{" "}
        <chakra.kbd fontFamily="mono">#</chakra.kbd> to light it up, then click
        it. Dragging it onto Langy works too.
      </Text>
      <chakra.button
        type="button"
        aria-label="Dismiss hint"
        onClick={onDismiss}
        display="grid"
        placeItems="center"
        borderWidth={0}
        background="transparent"
        color="fg.subtle"
        cursor="pointer"
        flexShrink={0}
        _hover={{ color: "fg" }}
      >
        <X size={12} />
      </chakra.button>
    </HStack>
  );
}

/** One quiet summary replaces the old wrapping pile of context/skill pills. */
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
  // Panel -> page. Running the pointer down this list lights each chip's real
  // card up where it sits, so "workflow: checkout" stops being a word the user
  // has to take on trust and becomes the card they can see.
  const setSpotlight = useLangyContextTargetStore((s) => s.setSpotlight);
  const spotlight = (chip: LangyContextChip) => ({
    onMouseEnter: () => setSpotlight(chip.id),
    onMouseLeave: () => setSpotlight(null),
    onFocus: () => setSpotlight(chip.id),
    onBlur: () => setSpotlight(null),
  });

  return (
    <Menu.Root
      positioning={{ placement: "top-start", gutter: 6 }}
      // A closing menu must take its spotlight with it, or the page keeps
      // glowing at a chip nobody is pointing at any more.
      onOpenChange={(details) => {
        if (!details.open) setSpotlight(null);
      }}
    >
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
                  {...spotlight(chip)}
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
              {...spotlight(chip)}
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
