import havenIcon from "@langwatch/design-system-internal/assets/haven.svg";
import { Kbd } from "@langwatch/design-system/kbd";
import {
  Box,
  Button,
  HStack,
  IconButton,
  Image,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { nowInstant } from "@langwatch/time";
import {
  Copy,
  ExternalLink,
  EyeOff,
  MousePointerClick,
  RotateCcw,
  SquareDashed,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";

import { captureSubject } from "./capture";
import {
  buildFeedback,
  describeTarget,
  type Box as Rect,
  type havenEndpoint,
  postToHaven,
  type Subject,
} from "./feedback";
import { currentTheme, hideForSession, setTheme, THEME_LABELS, THEMES } from "./orb-prefs";
import type { PageBuffer } from "./page-buffer";
import { type Hovered, pickElement, selectRegion } from "./pickers";

const factsSchema = z.object({
  slug: z.string(),
  branch: z.string(),
  commit: z.string(),
  links: z.array(z.object({ label: z.string(), href: z.string().regex(/^https?:\/\//u) })),
});
type Facts = z.infer<typeof factsSchema>;

export type Orb = {
  host: Window & typeof globalThis;
  buffer: PageBuffer;
  send: typeof fetch;
  endpoint: ReturnType<typeof havenEndpoint>;
};

/** Langy's launcher is 46px, 20px off the bottom-right corner; the orb sits centred above it. */
const ORB = { size: 36, right: 25, bottom: 78 };
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

type Reach = { status: "asking" } | { status: "offline" } | { status: "ready"; facts: Facts };
type Mode = "idle" | "element" | "region";
type Sent = "sent" | "refused" | undefined;

const loadFacts = async ({ send, endpoint }: Orb): Promise<Reach> => {
  try {
    const response = await send(endpoint.base);
    const parsed = factsSchema.safeParse(response.ok ? await response.json() : undefined);
    return parsed.success ? { status: "ready", facts: parsed.data } : { status: "offline" };
  } catch {
    return { status: "offline" };
  }
};

const describeSubject = ({ subject }: { subject: Subject }): string => {
  if (subject.kind === "region") {
    const { width, height } = subject.box;
    return `Region ${Math.round(width)} × ${Math.round(height)}`;
  }
  return describeTarget({ element: subject.element }).selector;
};

const stackLine = ({ reach, slug }: { reach: Reach; slug: string }) =>
  reach.status === "ready"
    ? [reach.facts.slug, reach.facts.branch, reach.facts.commit].filter(Boolean).join(" · ")
    : slug;

const nextFrame = ({ host }: { host: Window }) =>
  new Promise((resolve) => host.requestAnimationFrame(resolve));

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="xs" fontWeight="medium" color="fg.subtle">
      {children}
    </Text>
  );
}

function Highlight({ hovered }: { hovered: Hovered }) {
  const { box, component, testId, tag } = hovered;
  const below = box.y < 28;
  return (
    <Box
      position="fixed"
      pointerEvents="none"
      left={`${box.x}px`}
      top={`${box.y}px`}
      width={`${box.width}px`}
      height={`${box.height}px`}
      borderWidth="2px"
      borderColor="orange.solid"
      borderRadius="sm"
      bg="orange.solid/10"
      transitionProperty="top, left, width, height"
      transitionDuration="faster"
      transitionTimingFunction="ease-out"
      _motionReduce={{ transition: "none" }}
    >
      <HStack
        position="absolute"
        left="-2px"
        {...(below ? { top: "100%", marginTop: 1.5 } : { bottom: "100%", marginBottom: 1.5 })}
        gap={1.5}
        paddingX={1.5}
        paddingY={0.5}
        borderRadius="sm"
        bg="orange.solid"
        color="orange.contrast"
        textStyle="xs"
        fontFamily="mono"
        whiteSpace="nowrap"
        boxShadow="sm"
      >
        <Text fontWeight="semibold">{component ?? tag}</Text>
        {testId ? <Text opacity={0.85}>{testId}</Text> : null}
        <Text opacity={0.7}>
          {Math.round(box.width)} × {Math.round(box.height)}
        </Text>
      </HStack>
    </Box>
  );
}

function PickerOverlay({
  mode,
  hovered,
  drawn,
}: {
  mode: Exclude<Mode, "idle">;
  hovered: Hovered | undefined;
  drawn: Rect | undefined;
}) {
  return (
    <>
      {mode === "region" ? <Box position="fixed" inset={0} cursor="crosshair" /> : null}
      {mode === "element" && hovered ? <Highlight hovered={hovered} /> : null}
      {mode === "region" && drawn ? <Highlight hovered={{ box: drawn, tag: "region" }} /> : null}
      <HStack
        position="fixed"
        top={4}
        left="50%"
        transform="translateX(-50%)"
        pointerEvents="none"
        gap={2}
        paddingX={3.5}
        paddingY={1.5}
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.muted"
        bg="bg.panel"
        boxShadow="lg"
        textStyle="sm"
        animationName="fade-in, slide-from-top"
        animationDuration="moderate"
      >
        <Text>{mode === "element" ? "Click an element" : "Drag over a region"}</Text>
        <Text color="fg.subtle">·</Text>
        <Kbd>Esc</Kbd>
        <Text color="fg.muted">to cancel</Text>
      </HStack>
    </>
  );
}

function OrbButton({
  open,
  reach,
  onToggle,
}: {
  open: boolean;
  reach: Reach;
  onToggle: () => void;
}) {
  return (
    <Box
      as="button"
      position="fixed"
      right={`${ORB.right}px`}
      bottom={`${ORB.bottom}px`}
      width={`${ORB.size}px`}
      height={`${ORB.size}px`}
      display="grid"
      placeItems="center"
      borderRadius="full"
      borderWidth="1px"
      borderColor={open ? "orange.solid" : "border.emphasized"}
      bg="bg.panel"
      boxShadow="md"
      cursor="pointer"
      transition={`transform 200ms ${EASE}, box-shadow 160ms ease, border-color 160ms ease`}
      _hover={{ transform: "translateY(-1px)", boxShadow: "lg", borderColor: "orange.emphasized" }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "orange.focusRing",
        outlineOffset: "2px",
      }}
      aria-label="Haven dev tools"
      aria-expanded={open}
      title="Haven dev tools"
      onClick={onToggle}
    >
      <Image src={havenIcon} alt="" boxSize="22px" borderRadius="md" />
      <Box
        position="absolute"
        top="0"
        right="0"
        boxSize="9px"
        borderRadius="full"
        borderWidth="2px"
        borderColor="bg.panel"
        bg={reach.status === "ready" ? "green.solid" : "fg.subtle"}
      />
    </Box>
  );
}

function PreviewBody({ image, capturing }: { image?: string; capturing: boolean }) {
  if (capturing) {
    return (
      <HStack gap={2} color="fg.muted" textStyle="xs">
        <Spinner size="xs" />
        <Text>Capturing…</Text>
      </HStack>
    );
  }
  if (!image) {
    return (
      <Text textStyle="xs" color="fg.muted" textAlign="center">
        The page would not render an image; the note still names the selection.
      </Text>
    );
  }
  return (
    <Image
      src={image}
      alt="Capture of the selection"
      maxHeight="180px"
      maxWidth="100%"
      objectFit="contain"
      borderRadius="sm"
      boxShadow="xs"
    />
  );
}

const SENT_LINE = {
  sent: { color: "fg.success", text: "Sent. An agent reads it with haven feedback list --open." },
  refused: { color: "fg.error", text: "Haven did not take it. Your note is kept; try again." },
};

const COPY_LABEL = { idle: "Copy debug info", copied: "Copied", refused: "Clipboard refused" };

function Preview({
  subject,
  image,
  capturing,
  onRepick,
  onRemove,
}: {
  subject: Subject;
  image?: string;
  capturing: boolean;
  onRepick: () => void;
  onRemove: () => void;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      overflow="hidden"
      animationName="fade-in, scale-in"
      animationDuration="moderate"
    >
      <Box bg="bg.subtle" display="grid" placeItems="center" minHeight="96px" padding={2}>
        <PreviewBody image={image} capturing={capturing} />
      </Box>
      <HStack
        gap={1}
        paddingLeft={3}
        paddingRight={1}
        paddingY={1}
        borderTopWidth="1px"
        borderColor="border.muted"
      >
        <Text flex={1} textStyle="xs" fontFamily="mono" color="fg.muted" truncate>
          {describeSubject({ subject })}
        </Text>
        <IconButton
          aria-label="Pick again"
          title="Pick again"
          size="2xs"
          variant="ghost"
          onClick={onRepick}
        >
          <RotateCcw />
        </IconButton>
        <IconButton
          aria-label="Remove"
          title="Remove"
          size="2xs"
          variant="ghost"
          onClick={onRemove}
        >
          <X />
        </IconButton>
      </HStack>
    </Box>
  );
}

type Capture = { subject?: Subject; image?: string; capturing: boolean };

function useFeedbackDraft({ orb, shell }: { orb: Orb; shell: HTMLElement }) {
  const { host, buffer, send, endpoint } = orb;
  const [mode, setMode] = useState<Mode>("idle");
  const [hovered, setHovered] = useState<Hovered>();
  const [drawn, setDrawn] = useState<Rect>();
  const [capture, setCapture] = useState<Capture>({ capturing: false });
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent>();

  const choose = async (kind: Exclude<Mode, "idle">) => {
    setMode(kind);
    setHovered(undefined);
    setDrawn(undefined);
    setSent(undefined);
    const subject: Subject | undefined =
      kind === "element"
        ? await pickElement({ host, isOwn: (el) => shell.contains(el), onHover: setHovered }).then(
            (element) => (element ? { kind: "element", element } : undefined),
          )
        : await selectRegion({ host, onDraw: setDrawn }).then((box) =>
            box ? { kind: "region", box } : undefined,
          );
    setMode("idle");
    if (!subject) return;
    setCapture({ subject, capturing: true });
    await nextFrame({ host });
    const image = await captureSubject({ host, subject, exclude: shell });
    setCapture({ subject, image, capturing: false });
  };

  const submit = async () => {
    const { subject, image } = capture;
    const text = note.trim();
    if (!subject || !text || sending) return;
    setSending(true);
    const body = buildFeedback({ note: text, subject, buffer, host, image });
    const ok = await postToHaven({ send, url: `${endpoint.base}/feedback`, body });
    setSending(false);
    setSent(ok ? "sent" : "refused");
    if (!ok) return;
    setNote("");
    setCapture({ capturing: false });
  };

  const remove = () => setCapture({ capturing: false });
  return { mode, hovered, drawn, capture, note, setNote, sending, sent, choose, submit, remove };
}

type Draft = ReturnType<typeof useFeedbackDraft>;

function FeedbackSection({ draft }: { draft: Draft }) {
  const { capture, note, setNote, sending, sent, choose, submit, remove } = draft;
  const { subject } = capture;
  const repick = () => void choose(subject?.kind === "region" ? "region" : "element");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => noteRef.current?.focus(), [subject]);
  return (
    <VStack align="stretch" gap={2.5}>
      <SectionLabel>Feedback for an agent</SectionLabel>
      {subject ? (
        <Preview {...capture} subject={subject} onRepick={repick} onRemove={remove} />
      ) : (
        <HStack gap={2}>
          <Button flex={1} size="sm" variant="outline" onClick={() => void choose("element")}>
            <MousePointerClick /> Pick element
          </Button>
          <Button flex={1} size="sm" variant="outline" onClick={() => void choose("region")}>
            <SquareDashed /> Select region
          </Button>
        </HStack>
      )}
      {subject ? (
        <>
          <Textarea
            size="sm"
            rows={3}
            resize="vertical"
            ref={noteRef}
            aria-label="Feedback note"
            placeholder="What should change here?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
            }}
          />
          <Button
            size="sm"
            colorPalette="orange"
            loading={sending}
            disabled={!note.trim()}
            onClick={() => void submit()}
          >
            Send to haven
          </Button>
        </>
      ) : null}
      {sent ? (
        <Text as="output" display="block" textStyle="xs" color={SENT_LINE[sent].color}>
          {SENT_LINE[sent].text}
        </Text>
      ) : null}
    </VStack>
  );
}

const debugInfo = ({ host, stack }: { host: Window; stack: string }) =>
  JSON.stringify(
    {
      page: host.location.href,
      stack,
      viewport: `${host.innerWidth}×${host.innerHeight}`,
      userAgent: host.navigator.userAgent,
      at: nowInstant().toString(),
    },
    null,
    2,
  );

function Header({
  orb,
  reach,
  retry,
  onClose,
}: {
  orb: Orb;
  reach: Reach;
  retry: () => void;
  onClose: () => void;
}) {
  return (
    <VStack align="stretch" gap={3} paddingX={4} paddingTop={4}>
      <HStack gap={3}>
        <Image src={havenIcon} alt="" boxSize={8} borderRadius="lg" />
        <VStack align="start" gap={0} flex={1} minWidth={0}>
          <Text textStyle="sm" fontWeight="semibold">
            Haven
          </Text>
          <Text textStyle="xs" fontFamily="mono" color="fg.muted" truncate maxWidth="100%">
            {stackLine({ reach, slug: orb.endpoint.slug })}
          </Text>
        </VStack>
        <IconButton aria-label="Close" size="xs" variant="ghost" onClick={onClose}>
          <X />
        </IconButton>
      </HStack>
      {reach.status === "offline" ? (
        <HStack
          gap={2}
          paddingLeft={3}
          paddingRight={1}
          paddingY={1}
          borderRadius="md"
          bg="bg.subtle"
        >
          <Text flex={1} textStyle="xs" color="fg.muted">
            Haven is not answering for this stack.
          </Text>
          <Button size="2xs" variant="ghost" onClick={retry}>
            Retry
          </Button>
        </HStack>
      ) : null}
    </VStack>
  );
}

function Links({ orb, reach }: { orb: Orb; reach: Reach }) {
  if (reach.status !== "ready") return null;
  const home = { label: "Home", href: new URL(orb.endpoint.base).origin };
  return (
    <VStack align="stretch" gap={2}>
      <SectionLabel>Consoles</SectionLabel>
      <HStack gap={1.5} wrap="wrap">
        {[home, ...reach.facts.links].map(({ label, href }) => (
          <Button key={href} asChild size="xs" variant="subtle">
            <a href={href} target="_blank" rel="noreferrer">
              {label} <ExternalLink />
            </a>
          </Button>
        ))}
      </HStack>
    </VStack>
  );
}

function ThemeRow({ host }: { host: Window }) {
  const [theme, setChosen] = useState(currentTheme({ host }));
  return (
    <HStack justify="space-between">
      <SectionLabel>Theme</SectionLabel>
      <SegmentedControl
        size="xs"
        value={theme}
        items={THEMES.map((value) => ({ value, label: THEME_LABELS[value] }))}
        onValueChange={({ value }) => {
          const next = THEMES.find((candidate) => candidate === value);
          if (!next) return;
          setTheme({ host, theme: next });
          setChosen(next);
        }}
      />
    </HStack>
  );
}

function Footer({ orb, reach, onHide }: { orb: Orb; reach: Reach; onHide: () => void }) {
  const { host } = orb;
  const [copied, setCopied] = useState<keyof typeof COPY_LABEL>("idle");
  const copy = () =>
    void host.navigator.clipboard
      .writeText(debugInfo({ host, stack: stackLine({ reach, slug: orb.endpoint.slug }) }))
      .then(
        () => setCopied("copied"),
        () => setCopied("refused"),
      );
  return (
    <HStack
      gap={1}
      paddingX={2}
      paddingY={1.5}
      bg="bg.subtle"
      borderTopWidth="1px"
      borderColor="border.muted"
    >
      <Button size="xs" variant="ghost" onClick={copy}>
        <Copy /> {COPY_LABEL[copied]}
      </Button>
      <Button asChild size="xs" variant="ghost">
        <a href={`${host.location.origin}/api`} target="_blank" rel="noreferrer">
          Open API
        </a>
      </Button>
      <Box flex={1} />
      <Button size="xs" variant="ghost" title="Hide the orb until this tab closes" onClick={onHide}>
        <EyeOff /> Hide
      </Button>
    </HStack>
  );
}

/** The orb, its panel and the picker overlay; mounted beside the app by orb-client.ts. */
export function OrbIsland({
  orb,
  shell,
  onHide,
}: {
  orb: Orb;
  shell: HTMLElement;
  onHide: () => void;
}) {
  const { host } = orb;
  const [open, setOpen] = useState(false);
  const [reach, setReach] = useState<Reach>({ status: "asking" });
  const draft = useFeedbackDraft({ orb, shell });
  const ask = useCallback(() => {
    setReach({ status: "asking" });
    void loadFacts(orb).then(setReach);
  }, [orb]);
  useEffect(ask, [ask]);
  const shown = open && draft.mode === "idle";
  const hide = () => {
    hideForSession({ host });
    onHide();
  };

  return (
    <>
      <VStack
        as="section"
        aria-label="Haven dev tools"
        aria-hidden={!shown}
        position="fixed"
        right="20px"
        bottom={`${ORB.bottom + ORB.size + 10}px`}
        width="344px"
        maxHeight="calc(100vh - 140px)"
        overflowY="auto"
        align="stretch"
        gap={4}
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="xl"
        boxShadow="lg"
        transformOrigin="bottom right"
        opacity={shown ? 1 : 0}
        transform={shown ? "none" : "translateY(8px) scale(0.97)"}
        visibility={shown ? "visible" : "hidden"}
        pointerEvents={shown ? "auto" : "none"}
        transition={`opacity 160ms ease, transform 220ms ${EASE}, visibility 0s linear ${shown ? "0s" : "220ms"}`}
        _motionReduce={{ transition: "none" }}
      >
        <Header orb={orb} reach={reach} retry={ask} onClose={() => setOpen(false)} />
        <VStack align="stretch" gap={5} paddingX={4}>
          <FeedbackSection draft={draft} />
          <ThemeRow host={host} />
          <Links orb={orb} reach={reach} />
        </VStack>
        <Footer orb={orb} reach={reach} onHide={hide} />
      </VStack>
      <OrbButton open={open} reach={reach} onToggle={() => setOpen((was) => !was)} />
      {draft.mode === "idle" ? null : (
        <PickerOverlay mode={draft.mode} hovered={draft.hovered} drawn={draft.drawn} />
      )}
    </>
  );
}
