import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Filter,
  Layers,
  LayoutGrid,
  MessageSquare,
  Plus,
  Server,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Kbd } from "~/components/ops/shared/Kbd";
import { useViewStore } from "../../stores/viewStore";
import { useWelcomeStore } from "../../stores/welcomeStore";
import { useWelcomeSeen } from "../../hooks/useWelcomeSeen";

const TOTAL_STEPS = 3;
const ACTIVATION_DURATION_MS = 2200;
const ACTIVATION_DURATION_S = ACTIVATION_DURATION_MS / 1000;

type Phase = "welcome" | "activating";

/*
 * Animation strategy — motion library, one cohesive blob, real linger.
 *
 * Three coordinated tracks, all driven by motion's animate prop:
 *   1. The blob (motion.ellipse) — rises, swells, lingers bulbous at
 *      center, then stretches and dissolves.
 *   2. The welcome content (motion.div) — gently lifts and fades.
 *   3. The glass backdrop (motion.div) — fades to reveal traces page.
 *
 * `times` arrays give precise control over phase weights — the peak
 * "linger" is from t=0.34 to t=0.58 (~530ms of dominant presence) so
 * the blob doesn't feel rushed.
 *
 * No filters, no goo, no backdrop-filter during animation. Pure
 * transform + opacity on one SVG primitive.
 */
const BLOB_KEYFRAMES = {
  y:       [280, 200, 110,  25,  -10, -50, -210, -420],
  scaleX:  [0.25, 0.85, 1.25, 1.55, 1.6, 1.5, 0.95, 0.35],
  scaleY:  [0.2,  0.55, 0.85, 1.45, 1.55, 1.7, 2.3,  2.9],
  opacity: [0,    0.85, 1,    1,    1,   0.95, 0.45, 0],
};
const BLOB_TIMES = [0, 0.08, 0.2, 0.34, 0.46, 0.58, 0.78, 1];

export const WelcomeScreen: React.FC = () => {
  const isOpen = useWelcomeStore((s) => s.isOpen);
  const close = useWelcomeStore((s) => s.close);
  const { markSeen } = useWelcomeSeen();
  const selectLens = useViewStore((s) => s.selectLens);

  const [step, setStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [phase, setPhase] = useState<Phase>("welcome");

  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setDontShowAgain(false);
      setPhase("welcome");
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (dontShowAgain) markSeen();
    close();
  }, [dontShowAgain, markSeen, close]);

  const handleFinish = useCallback(() => {
    markSeen();
    selectLens("all-traces");
    setPhase("activating");
    window.setTimeout(() => close(), ACTIVATION_DURATION_MS);
  }, [markSeen, selectLens, close]);

  const next = useCallback(
    () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1)),
    [],
  );
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  if (!isOpen) return null;

  const isActivating = phase === "activating";

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Traces"
      initial={false}
      animate={{ opacity: isActivating ? 0 : 1 }}
      transition={{
        duration: isActivating ? ACTIVATION_DURATION_S : 0,
        ease: [0.32, 0.72, 0, 1],
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        overflow: "hidden",
        // Glass backdrop only while idle; dropped at activation so the
        // expensive filter doesn't run while motion is animating other layers.
        ...(isActivating
          ? {}
          : {
              backdropFilter: "blur(20px) saturate(1.3)",
              WebkitBackdropFilter: "blur(20px) saturate(1.3)",
            }),
      }}
    >
      <Box
        position="absolute"
        inset={0}
        bg="rgba(255,255,255,0.55)"
        _dark={{ bg: "rgba(20,22,30,0.55)" }}
        pointerEvents="none"
      />
      {/* Soft tinted backdrop — barely visible blue wash through the glass */}
      <Box
        position="absolute"
        inset={0}
        backgroundImage="radial-gradient(circle at 50% 60%, var(--chakra-colors-blue-subtle) 0%, transparent 65%)"
        opacity={0.55}
        pointerEvents="none"
      />

      {/* Always mounted so the SVG layer + gradient stops are primed before
          the user clicks Get started. */}
      <ActivationFx active={isActivating} />

      <motion.div
        initial={false}
        animate={{
          y: isActivating ? -56 : 0,
          opacity: isActivating ? 0 : 1,
          scale: isActivating ? 0.97 : 1,
        }}
        transition={{
          duration: isActivating ? ACTIVATION_DURATION_S * 0.85 : 0,
          ease: [0.32, 0.72, 0, 1],
        }}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          willChange: "transform, opacity",
        }}
      >
          {phase === "welcome" && (
            <Box position="absolute" top={4} right={4} zIndex={1}>
              <Button
                size="sm"
                variant="ghost"
                color="fg.muted"
                onClick={handleClose}
                aria-label="Close welcome"
              >
                <Icon boxSize={4}><X /></Icon>
              </Button>
            </Box>
          )}

          <VStack gap={6} maxWidth="820px" width="full" align="stretch">
            <HeroBand step={step} />

            <Box paddingX={2}>
              {step === 0 && <WhatsChangedStep />}
              {step === 1 && <WhatAreLensesStep />}
              {step === 2 && <TryItStep />}
            </Box>

            <Flex
              align="center"
              justify="space-between"
              gap={4}
              paddingTop={2}
              paddingX={2}
            >
              <HStack gap={4} align="center">
                <StepDots current={step} total={TOTAL_STEPS} />
                <Checkbox
                  size="sm"
                  checked={dontShowAgain}
                  onCheckedChange={(e) => setDontShowAgain(!!e.checked)}
                >
                  <Text textStyle="xs" color="fg.muted">
                    Don&apos;t show again
                  </Text>
                </Checkbox>
              </HStack>
              <HStack gap={2}>
                {step > 0 && (
                  <Button size="sm" variant="ghost" onClick={back}>
                    Back
                  </Button>
                )}
                {step < TOTAL_STEPS - 1 ? (
                  <Button size="sm" colorPalette="blue" onClick={next}>
                    Next
                    <Icon boxSize={3.5}><ArrowRight /></Icon>
                  </Button>
                ) : (
                  <Button size="md" colorPalette="blue" onClick={handleFinish}>
                    Get started
                    <Icon boxSize={4}><ArrowRight /></Icon>
                  </Button>
                )}
              </HStack>
            </Flex>
          </VStack>
      </motion.div>
    </motion.div>
  );
};

/* ──────────────────────────────────────────────────────────────────
 * Activation FX — single SVG, gooey merge, GPU-friendly
 * ──────────────────────────────────────────────────────────────────
 * Why one SVG: the goo filter (heavy gaussian blur + alpha threshold)
 * is the expensive part. Putting it on an HTML parent forces the
 * browser to re-rasterize the whole HTML subtree every frame. Putting
 * it inside one SVG element scopes the filter to that SVG canvas,
 * which the compositor treats as a single layer.
 */
const ActivationFx: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    // 1000×1000 viewBox — keyframe values are in SVG units so the animation
    // reads consistently regardless of viewport dimensions.
    viewBox="0 0 1000 1000"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: 1,
    }}
  >
    <defs>
      {/*
       * Layered radial gradient — bright core that progressively fades
       * to fully transparent. Most of the radius is in the soft falloff
       * zone, which is what gives the blob its glow/cloud quality.
       */}
      <radialGradient id="welcome-blob-fill" cx="50%" cy="42%" r="50%">
        <stop offset="0%"  stopColor="#dbeafe" stopOpacity="0.95" />
        <stop offset="15%" stopColor="#93c5fd" stopOpacity="0.85" />
        <stop offset="35%" stopColor="#60a5fa" stopOpacity="0.65" />
        <stop offset="55%" stopColor="#3b82f6" stopOpacity="0.4" />
        <stop offset="75%" stopColor="#6366f1" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
      </radialGradient>
      {/*
       * Big gaussian blur on a single SVG primitive. Because it's one
       * tiny element being filtered (not an HTML subtree), the cost per
       * frame is negligible — the SVG composites once as a single layer.
       * This is what makes the edges look truly soft and organic.
       */}
      <filter
        id="welcome-blob-soft"
        x="-50%"
        y="-50%"
        width="200%"
        height="200%"
      >
        <feGaussianBlur stdDeviation="28" />
      </filter>
    </defs>

    {/*
     * Single cohesive blob. Always mounted, parked at the rest position
     * (matching keyframe-0) during the welcome phase so the SVG layer,
     * gradient stops, and filter pipeline are all primed by the time the
     * user clicks Get started. Motion drives the keyframe array on activation.
     */}
    <motion.ellipse
      cx={500}
      cy={500}
      rx={300}
      ry={300}
      fill="url(#welcome-blob-fill)"
      filter="url(#welcome-blob-soft)"
      style={{ transformOrigin: "500px 500px", willChange: "transform, opacity" }}
      initial={{ y: 280, scaleX: 0.25, scaleY: 0.2, opacity: 0 }}
      animate={
        active
          ? {
              y: BLOB_KEYFRAMES.y,
              scaleX: BLOB_KEYFRAMES.scaleX,
              scaleY: BLOB_KEYFRAMES.scaleY,
              opacity: BLOB_KEYFRAMES.opacity,
            }
          : { y: 280, scaleX: 0.25, scaleY: 0.2, opacity: 0 }
      }
      transition={{
        duration: ACTIVATION_DURATION_S,
        times: BLOB_TIMES,
        // Out-expo: gentle start (no thud), decisive resolve.
        ease: [0.16, 1, 0.3, 1],
      }}
    />
  </svg>
);

/* ──────────────────────────────────────────────────────────────────
 * Hero band
 * ────────────────────────────────────────────────────────────────── */

const HeroBand: React.FC<{ step: number }> = ({ step }) => (
  <Box
    position="relative"
    paddingX={6}
    paddingY={6}
    borderRadius="xl"
    borderWidth="1px"
    borderColor="border.muted"
    overflow="hidden"
    backgroundImage="linear-gradient(135deg, var(--chakra-colors-purple-subtle) 0%, var(--chakra-colors-blue-subtle) 60%, var(--chakra-colors-cyan-subtle) 100%)"
  >
    <Box
      position="absolute"
      top="-60px"
      right="-60px"
      width="240px"
      height="240px"
      borderRadius="full"
      bg="purple.solid"
      opacity={0.18}
      filter="blur(60px)"
      pointerEvents="none"
    />
    <Box
      position="absolute"
      bottom="-80px"
      left="-40px"
      width="220px"
      height="220px"
      borderRadius="full"
      bg="blue.solid"
      opacity={0.15}
      filter="blur(60px)"
      pointerEvents="none"
    />
    <VStack align="stretch" gap={2} position="relative">
      <HStack gap={2}>
        <Badge colorPalette="purple" variant="solid" size="sm" borderRadius="full">
          <Icon boxSize={3}><Sparkles /></Icon>
          Alpha
        </Badge>
        <Text textStyle="xs" color="fg.muted" fontWeight="medium">
          Traces · v2
        </Text>
      </HStack>
      <Heading size="2xl" letterSpacing="-0.02em">
        {step === 0 && "Welcome to the new Traces"}
        {step === 1 && "Lenses, briefly"}
        {step === 2 && "Before you dive in"}
      </Heading>
      <Text color="fg.muted" textStyle="md" maxWidth="600px">
        {step === 0 && "A faster, more focused way to explore what your AI agents are doing."}
        {step === 1 && "Saved views that capture columns, filters, sort, and grouping as a single tab."}
        {step === 2 && "A few keyboard shortcuts and one important note about alpha."}
      </Text>
    </VStack>
  </Box>
);

const StepDots: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <HStack gap={1.5} aria-hidden="true">
    {Array.from({ length: total }).map((_, i) => (
      <Box
        key={i}
        width={i === current ? "20px" : "6px"}
        height="6px"
        borderRadius="full"
        bg={i === current ? "blue.solid" : "border.emphasized"}
        transition="all 0.2s ease"
      />
    ))}
  </HStack>
);

/* ──────────────────────────────────────────────────────────────────
 * Step 1: What's changed
 * ────────────────────────────────────────────────────────────────── */

const WhatsChangedStep: React.FC = () => (
  <VStack align="stretch" gap={5}>
    <LayoutPreview />
    <SimpleGrid columns={{ base: 1, md: 3 }} gap={3}>
      <FeatureCard
        icon={<Layers />}
        accent="purple"
        title="Lens-based views"
        body="Switch context with a tab — columns, filters, sort, and grouping all baked in."
      />
      <FeatureCard
        icon={<LayoutGrid />}
        accent="blue"
        title="One screen, three panels"
        body="Filters, results, and the trace drawer side by side. No more page hops."
      />
      <FeatureCard
        icon={<Zap />}
        accent="orange"
        title="Live, dense, formatted"
        body="Live-tail, density toggle, and rules that highlight the rows you care about."
      />
    </SimpleGrid>
  </VStack>
);

const LayoutPreview: React.FC = () => (
  <Box
    borderRadius="lg"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
    overflow="hidden"
    height="160px"
  >
    <Flex
      align="center"
      gap={1.5}
      paddingX={3}
      paddingY={1.5}
      borderBottomWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
    >
      <Box width="6px" height="6px" borderRadius="full" bg="red.400" />
      <Box width="6px" height="6px" borderRadius="full" bg="yellow.400" />
      <Box width="6px" height="6px" borderRadius="full" bg="green.400" />
      <HStack gap={1.5} marginLeft={3}>
        <FauxTab label="All" active />
        <FauxTab label="Conversations" />
        <FauxTab label="Errors" />
        <FauxTab label="By Model" />
      </HStack>
    </Flex>
    <HStack gap={0} align="stretch" height="calc(100% - 30px)">
      <Box width="22%" borderRightWidth="1px" borderColor="border.muted" padding={2}>
        <FauxLine width="60%" />
        <FauxLine width="80%" muted />
        <FauxLine width="50%" muted />
        <FauxLine width="70%" muted />
      </Box>
      <Box flex={1} padding={2}>
        <FauxLine width="40%" />
        <FauxLine width="90%" muted />
        <FauxLine width="85%" muted />
        <FauxLine width="92%" muted />
        <FauxLine width="78%" muted />
      </Box>
      <Box width="28%" borderLeftWidth="1px" borderColor="border.muted" padding={2} bg="bg.subtle">
        <FauxLine width="70%" />
        <FauxLine width="50%" muted />
        <FauxLine width="60%" muted />
        <FauxLine width="40%" muted />
      </Box>
    </HStack>
  </Box>
);

const FauxTab: React.FC<{ label: string; active?: boolean }> = ({ label, active }) => (
  <Box
    paddingX={2}
    paddingY={0.5}
    borderRadius="sm"
    fontSize="10px"
    fontWeight={active ? "semibold" : "medium"}
    color={active ? "blue.fg" : "fg.muted"}
    borderBottomWidth={active ? "2px" : "0"}
    borderColor="blue.solid"
  >
    {label}
  </Box>
);

const FauxLine: React.FC<{ width: string; muted?: boolean }> = ({ width, muted }) => (
  <Box
    height="6px"
    width={width}
    borderRadius="sm"
    bg={muted ? "border.muted" : "border.emphasized"}
    marginBottom={1.5}
  />
);

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  body: string;
  accent: "purple" | "blue" | "orange";
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, body, accent }) => (
  <VStack
    align="stretch"
    gap={2}
    padding={4}
    borderRadius="lg"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
    transition="all 0.15s ease"
    _hover={{ borderColor: "border.emphasized", transform: "translateY(-1px)" }}
  >
    <Flex
      width={9}
      height={9}
      borderRadius="md"
      bg={`${accent}.subtle`}
      color={`${accent}.fg`}
      align="center"
      justify="center"
    >
      <Icon boxSize={4}>{icon}</Icon>
    </Flex>
    <Heading size="sm" letterSpacing="-0.01em">{title}</Heading>
    <Text textStyle="xs" color="fg.muted" lineHeight="1.5">{body}</Text>
  </VStack>
);

/* ──────────────────────────────────────────────────────────────────
 * Step 2: What are lenses
 * ────────────────────────────────────────────────────────────────── */

const WhatAreLensesStep: React.FC = () => (
  <VStack align="stretch" gap={5}>
    <Text color="fg.muted" textStyle="sm">
      Six built-in lenses ship with traces. Tweak any of them and click{" "}
      <Box
        as="span"
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        width="18px"
        height="18px"
        borderRadius="sm"
        bg="blue.subtle"
        color="blue.fg"
        verticalAlign="middle"
      >
        <Icon boxSize={3}><Plus /></Icon>
      </Box>{" "}
      to save it as your own.
    </Text>

    <SimpleGrid columns={{ base: 1, md: 2 }} gap={2.5}>
      <LensCard icon={<LayoutGrid />} accent="blue" name="All Traces" desc="The flat list — no grouping" />
      <LensCard icon={<MessageSquare />} accent="green" name="Conversations" desc="Grouped by thread" />
      <LensCard icon={<AlertTriangle />} accent="red" name="Errors" desc="Only traces with errors" />
      <LensCard icon={<Bot />} accent="purple" name="By Model" desc="Grouped by LLM model" />
      <LensCard icon={<Server />} accent="cyan" name="By Service" desc="Grouped by service name" />
      <LensCard icon={<Users />} accent="orange" name="By User" desc="Grouped by user ID" />
    </SimpleGrid>

    <HStack
      gap={3}
      align="flex-start"
      borderRadius="md"
      paddingX={4}
      paddingY={3}
      borderWidth="1px"
      borderColor="blue.muted"
      background="blue.subtle"
    >
      <Icon boxSize={4} color="blue.fg" marginTop={0.5}>
        <Filter />
      </Icon>
      <VStack align="stretch" gap={1}>
        <Text textStyle="xs" fontWeight="semibold" color="blue.fg">
          Built-ins are read-only — but duplicable
        </Text>
        <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
          Right-click any built-in to duplicate it. Custom lenses you own can be
          renamed, saved, reverted, or deleted. A blue dot on a tab means it has
          unsaved changes.
        </Text>
      </VStack>
    </HStack>
  </VStack>
);

interface LensCardProps {
  icon: React.ReactNode;
  name: string;
  desc: string;
  accent: string;
}

const LensCard: React.FC<LensCardProps> = ({ icon, name, desc, accent }) => (
  <HStack
    gap={3}
    paddingX={3.5}
    paddingY={2.5}
    borderRadius="md"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
    transition="all 0.15s ease"
    _hover={{ borderColor: `${accent}.muted`, background: "bg.panel/70" }}
  >
    <Flex
      flexShrink={0}
      width={8}
      height={8}
      borderRadius="md"
      bg={`${accent}.subtle`}
      color={`${accent}.fg`}
      align="center"
      justify="center"
    >
      <Icon boxSize={4}>{icon}</Icon>
    </Flex>
    <VStack align="stretch" gap={0}>
      <Text textStyle="sm" fontWeight="semibold">{name}</Text>
      <Text textStyle="xs" color="fg.muted">{desc}</Text>
    </VStack>
  </HStack>
);

/* ──────────────────────────────────────────────────────────────────
 * Step 3: Try it
 * ────────────────────────────────────────────────────────────────── */

const TryItStep: React.FC = () => (
  <VStack align="stretch" gap={5}>
    <VStack align="stretch" gap={2.5}>
      <Heading size="sm" letterSpacing="-0.01em">Handy shortcuts</Heading>
      <SimpleGrid columns={{ base: 1, md: 2 }} gap={2.5}>
        <ShortcutRow keys={<Kbd>[</Kbd>} label="Collapse the filter sidebar" />
        <ShortcutRow
          keys={
            <HStack gap={1}>
              <Kbd>⌘</Kbd>
              <Kbd>F</Kbd>
            </HStack>
          }
          label="Find inside loaded traces"
        />
        <ShortcutRow keys={<Kbd>O</Kbd>} label="Open trace in full view" />
        <ShortcutRow keys={<Kbd>Esc</Kbd>} label="Close the trace drawer" />
      </SimpleGrid>
    </VStack>

    <VStack align="stretch" gap={2}>
      <Heading size="sm" letterSpacing="-0.01em">Need this tour again?</Heading>
      <Text textStyle="sm" color="fg.muted">
        It&apos;s tucked under the{" "}
        <Box
          as="span"
          display="inline-flex"
          alignItems="center"
          gap={1}
          paddingX={1.5}
          paddingY={0.5}
          borderRadius="sm"
          borderWidth="1px"
          borderColor="border.muted"
          bg="bg.panel"
          fontSize="xs"
          fontWeight="medium"
          verticalAlign="middle"
        >
          <Icon boxSize={3} color="purple.fg"><Sparkles /></Icon>
          What&apos;s new
        </Box>{" "}
        button in the toolbar.
      </Text>
    </VStack>

    <HStack
      gap={3}
      align="flex-start"
      paddingX={4}
      paddingY={3.5}
      borderRadius="md"
      borderWidth="1px"
      borderColor="purple.muted"
      backgroundImage="linear-gradient(135deg, var(--chakra-colors-purple-subtle) 0%, var(--chakra-colors-pink-subtle) 100%)"
    >
      <Icon boxSize={4} color="purple.fg" marginTop={0.5}>
        <Sparkles />
      </Icon>
      <VStack align="stretch" gap={1}>
        <Text textStyle="xs" fontWeight="semibold" color="purple.fg">This is alpha</Text>
        <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
          Things will change. If you hit something rough, please share feedback
          — your reports shape what ships.
        </Text>
      </VStack>
    </HStack>
  </VStack>
);

const ShortcutRow: React.FC<{ keys: React.ReactNode; label: string }> = ({
  keys,
  label,
}) => (
  <HStack
    gap={3}
    paddingX={3}
    paddingY={2}
    borderRadius="md"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
  >
    <Box flexShrink={0}>{keys}</Box>
    <Text textStyle="xs" color="fg.muted">{label}</Text>
  </HStack>
);
