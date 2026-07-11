import { Box, chakra, HStack, Text, Textarea } from "@chakra-ui/react";
import {
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
  X,
} from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type { LangyContextChip, LangySkillChip } from "../stores/langyStore";
import { LangyComposerPalette, type PaletteMode } from "./LangyComposerPalette";
import { LangyContextChipHover } from "./LangyContextChipHover";
import { LangyModelPill } from "./LangyModelPill";
import { LangySkillChipView } from "./LangySkillChip";

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
 * "Skills" USED to sit here as a third greyed-out button. It is gone because
 * skills are now real — they have a catalogue, a chip, and a `/` to summon them
 * — and leaving a dead button next to a live feature is how a UI teaches people
 * that its buttons are decoration.
 */
const COMPOSER_RAIL: { icon: LucideIcon; label: string }[] = [
  { icon: Gauge, label: "Reasoning effort" },
  { icon: Paperclip, label: "Attach a file" },
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
  skillChips = [],
  onAddSkill,
  onRemoveSkill,
  onRetargetSkill,
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
  /** Skills attached to this turn — "do this", optionally "on that". */
  skillChips?: LangySkillChip[];
  onAddSkill?: (id: string) => void;
  onRemoveSkill?: (id: string) => void;
  onRetargetSkill?: (skillId: string, targetChipId: string | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const reduceMotion = useReducedMotion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelPillRef = useRef<HTMLButtonElement>(null);

  /**
   * The command palette. `/` summons skills, `#` summons context.
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
    if ((event.key === "/" || event.key === "#") && atWordBoundary()) {
      event.preventDefault();
      setPaletteQuery("");
      setPalette(event.key === "/" ? "skill" : "context");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isBusy && canSend) onSend();
    }
  };

  return (
    // Tight at the bottom: the caption is a whisper under the input, not a
    // floor. The old symmetric 3.5 padding left a dead band below it that ate
    // vertical space the (now taller) panel would rather give to the answer.
    <Box
      paddingX={3.5}
      paddingTop={3}
      paddingBottom={2}
      background="transparent"
      flexShrink={0}
    >
      {/* While Langy is working the whole composer SINKS a few pixels and
          settles — a listening posture, not a bounce (long ease-out, no
          overshoot) — and grows a travelling sheen on its border. The wrapper
          owns both: the transform, and the radius the sheen ring inherits. */}
      <Box
        position="relative"
        borderRadius={COMPOSER_RADIUS}
        transform={
          isBusy && !reduceMotion ? "translateY(3px)" : "translateY(0)"
        }
        transition="transform 380ms cubic-bezier(0.32, 0.72, 0, 1)"
      >
        {isBusy ? <Box className="langy-composer-sheen" aria-hidden /> : null}
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
          boxShadow={
            focused ? "0 0 0 4px var(--chakra-colors-orange-subtle)" : undefined
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
              onPickSkill={(id) => {
                onAddSkill?.(id);
                closePalette();
              }}
              onPickChip={(id) => {
                // `#` on a chip that is already attached is a no-op that still
                // reads as success — the user asked for it to be there, and it
                // is. `onAddChip` restores it if they had dismissed it.
                onAddChip?.(id);
                closePalette();
              }}
              onPickModel={() => {
                closePalette();
                // `/model` hands over to the real picker rather than
                // reimplementing it in the palette.
                requestAnimationFrame(() => modelPillRef.current?.click());
              }}
              onClose={closePalette}
            />
          ) : null}

          {/* SKILLS FIRST, THEN CONTEXT — verbs above nouns.
              They are visually distinct on purpose: a skill chip is tinted and
              carries a target slot ("do this, on that"); a context chip is a
              quiet outline ("look at this"). Reading the row top-to-bottom is
              reading the instruction. */}
          {skillChips.length > 0 ||
          contextChips.length > 0 ||
          addableChips.length > 0 ? (
            <HStack
              gap={1.5}
              flexWrap="wrap"
              paddingX={3}
              paddingTop={palette ? 1 : 3}
            >
              {skillChips.map((chip) => (
                <LangySkillChipView
                  key={chip.id}
                  chip={chip}
                  contextChips={contextChips}
                  onRemove={() => onRemoveSkill?.(chip.id)}
                  onRetarget={(targetChipId) =>
                    onRetargetSkill?.(chip.id, targetChipId)
                  }
                />
              ))}
              {contextChips.map((chip) => (
                // The hover says what this chip actually HANDS to Langy — for a
                // filter, the query; for a selection, the rows. It reads the
                // same `ref` field that rides the wire, so it cannot describe a
                // fiction sitting next to the truth.
                <LangyContextChipHover key={chip.id} chip={chip}>
                  <ContextChip
                    chip={chip}
                    onRemove={() => onRemoveChip?.(chip.id)}
                  />
                </LangyContextChipHover>
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
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onTextareaKeyDown}
            placeholder={isBusy ? "Langy is working…" : COMPOSER_PLACEHOLDER}
            disabled={disabled || isBusy}
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
              ever shows what is real. Effort, skills and attachments have no
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
              ref={modelPillRef}
              model={model}
              options={modelOptions}
              onChange={onModelChange}
            />
            {COMPOSER_RAIL.map(({ icon, label }) => (
              <RailButton key={label} icon={icon} label={label} />
            ))}
            {/* The only discoverability the palette gets, and all it needs. It
                fades out the moment the composer is in use, so it is a hint on
                an empty field rather than a permanent label. */}
            {!input && !palette && skillChips.length === 0 ? (
              <Text
                textStyle="2xs"
                color="fg.subtle"
                whiteSpace="nowrap"
                display={{ base: "none", sm: "block" }}
                paddingLeft={1}
              >
                <chakra.kbd
                  fontFamily="mono"
                  borderWidth="1px"
                  borderColor="border.muted"
                  borderRadius="4px"
                  paddingX="3px"
                >
                  /
                </chakra.kbd>{" "}
                for skills
              </Text>
            ) : null}
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
      </Box>
      <Text
        marginTop={1.5}
        textStyle="2xs"
        color="fg.subtle"
        textAlign="center"
        letterSpacing="0.01em"
        lineHeight="1.2"
      >
        Langy proposes — you review and apply.
      </Text>
    </Box>
  );
}

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
