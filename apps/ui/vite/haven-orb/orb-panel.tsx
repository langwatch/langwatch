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
import { nowInstant } from "@langwatch/time";
import {
  Check,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  EyeOff,
  FlaskConical,
  MousePointerClick,
  RotateCcw,
  Server,
  SquareDashed,
  Wrench,
  X,
  type LucideIcon,
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
import { type Dock, SATELLITE, useLangyDock } from "./langy-dock";
import { hideForSession } from "./orb-prefs";
import type { PageBuffer } from "./page-buffer";
import { type Hovered, pickElement, selectRegion } from "./pickers";

const factsSchema = z.object({
  slug: z.string(),
  branch: z.string(),
  commit: z.string(),
  /** Web consoles carry http(s); a database is a bare host:port, copied rather than linked. */
  links: z.array(z.object({ label: z.string(), href: z.string(), status: z.string().optional() })),
});
const WEB = /^https?:\/\//u;
type Facts = z.infer<typeof factsSchema>;

export type Orb = {
  host: Window & typeof globalThis;
  buffer: PageBuffer;
  send: typeof fetch;
  endpoint: ReturnType<typeof havenEndpoint>;
};

/** Alone, a 36px orb 20px off the bottom-right corner; docked, see SATELLITE in langy-dock.ts. */
const STANDALONE = { size: 36, inset: 20 };
const PANEL_GAP = 10;
/** Langy's launcher glow at full proximity (use-langy-orb-proximity.ts GLOW_PEAK). */
const GLOW_PEAK = 0.16;
/** Langy's own morph curve and duration (langy-panel-chrome.ts SIZE_EASE). */
const MORPH = "340ms cubic-bezier(0.32, 0.72, 0, 1)";
/** Langy's floating-panel border and shadow (langy-panel-chrome.ts), on an opaque card. */
const CARD = {
  bg: "bg.panel",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "20px",
  boxShadow:
    "0 1px 2px rgba(20,20,23,0.04), 0 12px 28px rgba(20,20,23,0.10), 0 32px 64px rgba(20,20,23,0.10)",
  _dark: {
    boxShadow:
      "0 1px 2px rgba(0,0,0,0.4), 0 12px 28px rgba(0,0,0,0.5), 0 32px 64px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
  },
  /** The design system's small icon, as Langy's panel draws them. */
  css: { "& button svg, & a svg": { width: "14px", height: "14px" } },
} as const;

/** Where the orb's centre sits and how the panel hangs off it, docked or alone. */
const placement = ({ dock }: { dock: Dock | undefined }) => {
  if (!dock) {
    const centre = STANDALONE.inset + STANDALONE.size / 2;
    const below = centre + STANDALONE.size / 2 + PANEL_GAP;
    return {
      point: { right: `${centre}px`, bottom: `${centre}px` },
      size: STANDALONE.size,
      mirrored: false,
      edge: STANDALONE.size / 2,
      maxHeight: `calc(100vh - ${below + centre + 16}px)`,
    };
  }
  return {
    point: { left: `${dock.left}px`, top: `${dock.top}px` },
    size: SATELLITE,
    mirrored: dock.mirrored,
    edge: dock.edge,
    maxHeight: `${Math.max(dock.top - SATELLITE / 2 - PANEL_GAP - 16, 160)}px`,
  };
};
type Placement = ReturnType<typeof placement>;

/** While haven is not answering, the orb asks again this often, quietly. */
const REASK_EVERY_MS = 30_000;

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
    ? [reach.facts.branch, reach.facts.commit].filter(Boolean).join(" · ")
    : slug;

const nextFrame = ({ host }: { host: Window }) =>
  new Promise((resolve) => host.requestAnimationFrame(resolve));

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="xs" fontWeight="medium" color="fg.muted">
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
  place,
  onToggle,
}: {
  open: boolean;
  reach: Reach;
  place: Placement;
  onToggle: () => void;
}) {
  const { size } = place;
  const label = reach.status === "offline" ? "Haven dev tools (not answering)" : "Haven dev tools";
  return (
    <Box
      as="button"
      className="langy-root"
      position="absolute"
      left={`${-size / 2}px`}
      top={`${-size / 2}px`}
      width={`${size}px`}
      height={`${size}px`}
      display="grid"
      placeItems="center"
      borderRadius="full"
      bg="bg.surface"
      borderWidth="1px"
      borderColor="border.emphasized"
      boxShadow="md"
      cursor="pointer"
      transition={`transform ${MORPH}, box-shadow 160ms ease`}
      css={{
        "& .langy-orb-glow": { opacity: open ? GLOW_PEAK : 0, transition: "opacity 240ms ease" },
      }}
      _hover={{
        transform: "scale(1.12)",
        boxShadow: "lg",
        "& .langy-orb-glow": { opacity: GLOW_PEAK },
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "orange.focusRing",
        outlineOffset: "2px",
      }}
      _motionReduce={{ transition: "none", _hover: { transform: "none" } }}
      aria-label="Haven dev tools"
      aria-expanded={open}
      title={label}
      onClick={onToggle}
    >
      <span className="langy-orb-glow" aria-hidden />
      <Image
        src={havenIcon}
        alt=""
        boxSize="62%"
        borderRadius="sm"
        opacity={reach.status === "ready" ? 1 : 0.55}
        filter={reach.status === "ready" ? undefined : "grayscale(1)"}
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
    <VStack align="stretch" gap={2}>
      <SectionLabel>Feedback for an agent</SectionLabel>
      {subject ? (
        <Preview {...capture} subject={subject} onRepick={repick} onRemove={remove} />
      ) : (
        <HStack gap={2}>
          <Button flex={1} size="xs" variant="outline" onClick={() => void choose("element")}>
            <MousePointerClick /> Pick element
          </Button>
          <Button flex={1} size="xs" variant="outline" onClick={() => void choose("region")}>
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
            size="xs"
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
    <VStack align="stretch" gap={2} paddingLeft={3.5} paddingRight={2} paddingTop={2.5}>
      <HStack gap={2}>
        <Image src={havenIcon} alt="" boxSize={4} borderRadius="sm" />
        <Text textStyle="sm" fontWeight="semibold">
          Haven
        </Text>
        <Text flex={1} minWidth={0} textStyle="xs" color="fg.muted" truncate>
          {stackLine({ reach, slug: orb.endpoint.slug })}
        </Text>
        <IconButton aria-label="Close" size="xs" variant="ghost" onClick={onClose}>
          <X />
        </IconButton>
      </HStack>
      {reach.status === "offline" ? (
        <HStack gap={2} paddingLeft={2} paddingY={0.5} borderRadius="md" bg="bg.subtle">
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

type Link = Facts["links"][number];
type Group = { name: string; icon: LucideIcon; members: string[]; copies?: boolean };

/** Rows by what they are; a console haven adds later lands in Tools. */
const GROUPS: Group[] = [
  {
    name: "Stack",
    icon: Server,
    members: ["app", "api", "gateway", "nlp", "langyagent", "langevals"],
  },
  {
    name: "Sims",
    icon: FlaskConical,
    members: ["llm", "mail", "storage", "idp", "voice", "analytics", "outbound", "telemetry"],
  },
  { name: "Data", icon: Database, members: ["postgres", "redis", "clickhouse"], copies: true },
  { name: "Tools", icon: Wrench, members: [] },
];

const groupOf = ({ label }: Link): Group =>
  GROUPS.find(({ members }) => members.includes(label)) ?? GROUPS[GROUPS.length - 1]!;

const ROW = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  height: "28px",
  paddingX: 2,
  borderRadius: "md",
  textStyle: "xs",
  color: "fg",
  cursor: "pointer",
  minWidth: 0,
  _hover: { bg: "bg.muted", "& .trail": { opacity: 1 } },
  _focusVisible: {
    outline: "2px solid",
    outlineColor: "orange.focusRing",
    "& .trail": { opacity: 1 },
  },
  "& svg": { width: "14px", height: "14px", flexShrink: 0 },
  "& .trail": { opacity: 0, color: "fg.subtle", width: "12px", height: "12px", marginLeft: "auto" },
} as const;

/** The stack home's statuses (tools/thuishaven/adapters/dashboard/stackhome.go). */
const STATUS_COLOR: Record<string, string> = {
  live: "fg.success",
  starting: "fg.warning",
  down: "fg.error",
  "not-selected": "fg.subtle",
};

function ServiceRow({ link, group, host }: { link: Link; group: Group; host: Window }) {
  const [copied, setCopied] = useState(false);
  const Icon = group.icon;
  const status = link.status ? STATUS_COLOR[link.status] : undefined;
  const name = (
    <>
      <Text as="span" truncate>
        {link.label}
      </Text>
      {status ? (
        <>
          <Box
            as="span"
            aria-hidden
            title={link.status}
            boxSize="6px"
            flexShrink={0}
            borderRadius="full"
            bg={status}
          />
          <Text as="span" srOnly>
            {link.status}
          </Text>
        </>
      ) : null}
    </>
  );
  if (group.copies || !WEB.test(link.href)) {
    const copy = () =>
      void host.navigator.clipboard.writeText(link.href).then(() => setCopied(true));
    return (
      <Box as="button" {...ROW} title={`Copy ${link.href}`} onClick={copy}>
        <Icon color="var(--chakra-colors-fg-muted)" />
        {name}
        {copied ? <Check className="trail" /> : <Copy className="trail" />}
      </Box>
    );
  }
  return (
    <Box as="a" {...ROW} href={link.href} target="_blank" rel="noreferrer" title={link.href}>
      <Icon color="var(--chakra-colors-fg-muted)" />
      {name}
      <ExternalLink className="trail" />
    </Box>
  );
}

function ServiceGroup({ group, links, host }: { group: Group; links: Link[]; host: Window }) {
  const [open, setOpen] = useState(group.name === "Stack");
  if (links.length === 0) return null;
  return (
    <VStack align="stretch" gap={0.5}>
      <HStack
        as="button"
        gap={1}
        height="24px"
        color="fg.muted"
        cursor="pointer"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        _hover={{ color: "fg" }}
      >
        <Box
          as="span"
          display="inline-flex"
          transform={open ? "rotate(90deg)" : "none"}
          transition="transform 160ms ease"
          css={{ "& svg": { width: "12px", height: "12px" } }}
        >
          <ChevronRight />
        </Box>
        <Text textStyle="xs" fontWeight="medium">
          {group.name}
        </Text>
        <Text textStyle="xs" color="fg.subtle">
          {links.length}
        </Text>
      </HStack>
      {open ? (
        <Box display="grid" gridTemplateColumns="1fr 1fr" columnGap={1}>
          {links.map((link) => (
            <ServiceRow key={link.href} link={link} group={group} host={host} />
          ))}
        </Box>
      ) : null}
    </VStack>
  );
}

function Services({ orb, reach }: { orb: Orb; reach: Reach }) {
  if (reach.status !== "ready") return null;
  const home = { label: "Home", href: new URL(orb.endpoint.base).origin };
  const links = [home, ...reach.facts.links];
  return (
    <VStack align="stretch" gap={1}>
      {GROUPS.map((group) => (
        <ServiceGroup
          key={group.name}
          group={group}
          links={links
            .filter((link) => groupOf(link) === group)
            .toSorted((x, y) => group.members.indexOf(x.label) - group.members.indexOf(y.label))}
          host={orb.host}
        />
      ))}
    </VStack>
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
    <HStack gap={0.5} paddingX={2} paddingY={1.5} borderTopWidth="1px" borderColor="border.muted">
      <Button size="xs" variant="ghost" color="fg.muted" onClick={copy}>
        <Copy /> {COPY_LABEL[copied]}
      </Button>
      <Button asChild size="xs" variant="ghost" color="fg.muted">
        <a href={`${host.location.origin}/api`} target="_blank" rel="noreferrer">
          <ExternalLink /> Open API
        </a>
      </Button>
      <Box flex={1} />
      <Button
        size="xs"
        variant="ghost"
        color="fg.muted"
        title="Hide the orb until this tab closes"
        onClick={onHide}
      >
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
  useEffect(() => {
    if (reach.status !== "offline") return;
    const timer = host.setInterval(() => void loadFacts(orb).then(setReach), REASK_EVERY_MS);
    return () => host.clearInterval(timer);
  }, [host, orb, reach.status]);
  const toggle = () => {
    if (!open && reach.status === "offline") ask();
    setOpen(!open);
  };
  const shown = open && draft.mode === "idle";
  const hide = () => {
    hideForSession({ host });
    onHide();
  };

  const place = placement({ dock: useLangyDock({ host }) });
  const { mirrored, edge, size } = place;
  const below = size / 2 + PANEL_GAP;
  const origin = `${mirrored ? `${edge}px` : `calc(100% - ${edge}px)`} calc(100% + ${below}px)`;

  return (
    <>
      <Box position="fixed" width={0} height={0} {...place.point}>
        <VStack
          as="section"
          aria-label="Haven dev tools"
          aria-hidden={!shown}
          position="absolute"
          bottom={`${below}px`}
          {...(mirrored ? { left: `${-edge}px` } : { right: `${-edge}px` })}
          width="320px"
          maxHeight={place.maxHeight}
          overflowY="auto"
          align="stretch"
          gap={3}
          textStyle="xs"
          {...CARD}
          transformOrigin={origin}
          opacity={shown ? 1 : 0}
          transform={shown ? "none" : "scale(0.06)"}
          visibility={shown ? "visible" : "hidden"}
          pointerEvents={shown ? "auto" : "none"}
          transition={`opacity 200ms ease, transform ${MORPH}, visibility 0s linear ${shown ? "0s" : "340ms"}`}
          _motionReduce={{ transition: "none" }}
        >
          <Header orb={orb} reach={reach} retry={ask} onClose={() => setOpen(false)} />
          <VStack align="stretch" gap={3} paddingX={3.5}>
            <FeedbackSection draft={draft} />
            <Services orb={orb} reach={reach} />
          </VStack>
          <Footer orb={orb} reach={reach} onHide={hide} />
        </VStack>
        <OrbButton open={open} reach={reach} place={place} onToggle={toggle} />
      </Box>
      {draft.mode === "idle" ? null : (
        <PickerOverlay mode={draft.mode} hovered={draft.hovered} drawn={draft.drawn} />
      )}
    </>
  );
}
