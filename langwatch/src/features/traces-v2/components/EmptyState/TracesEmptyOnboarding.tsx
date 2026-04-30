import {
  Box,
  Button,
  chakra,
  HStack,
  Heading,
  Icon,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  AArrowDown,
  AArrowUp,
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  Filter,
  PanelRightOpen,
  Sparkles,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Link } from "~/components/ui/link";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useOpenTraceDrawer } from "../../hooks/useOpenTraceDrawer";
import { type Density, useDensityStore } from "../../stores/densityStore";
import {
  hasCompletedJourney,
  hasDensityBeenConfirmed,
  markDensityConfirmed,
  markJourneyCompleted,
  useOnboardingStageStore,
} from "../../stores/onboardingStageStore";
import { useUIStore } from "../../stores/uiStore";
import { IntegrateDrawer } from "./IntegrateDrawer";
import { findStageDef, type StageId } from "./onboardingJourneyConfig";
import {
  ARRIVAL_PREVIEW_TRACES,
  RICH_ARRIVAL_TRACE_ID,
} from "./samplePreviewTraces";

// Was 8s — too punchy. The highlighted row is *the* invitation moment of
// the whole journey, and 8s reads as "tap or we'll do it for you" rather
// than "explore at your own pace." 14s gives the user time to actually
// read the heading + subhead, notice the row glimmer, hover, and click
// because they want to — auto-open is a fallback for genuinely
// disengaged users, not the default path.
const POST_ARRIVAL_AUTO_OPEN_MS = 14000;

const INTEGRATE_KEY = "I";
const SKIP_KEY = "K";

// Typewriter cadence — paced slow enough that the preamble beats
// (welcome, aurora warning) don't fly in faster than the user can
// notice they exist. The earlier "fast" pass (26/14) made the heading
// arrive almost instantly on a fresh refresh, which read as the page
// grabbing at attention; pushing back to ~36/18 keeps each beat
// deliberate without dragging. Linger is the more important knob for
// individual stage hold — most stages set their own `holdMs`.
const TYPEWRITER_HEADING_MS = 36;
const TYPEWRITER_SUBHEAD_MS = 18;
const TYPEWRITER_GAP_MS = 280;
const TYPEWRITER_LINGER_MS = 900;

function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return true;
  return t.isContentEditable;
}

/**
 * Empty-state onboarding for the new Traces page.
 *
 * Hero copy and stage transitions are driven entirely from
 * `onboardingJourneyConfig.ts` — this component reads the current
 * stage from the store, looks up its definition, and renders
 * heading / subhead / optional CTA. Auto-advance, manual-CTA and
 * typewriter-driven advance all flow through here. Tweak the
 * journey by editing the config file, not this component.
 */
export function TracesEmptyOnboarding(): React.ReactElement {
  const { project, organization } = useOrganizationTeamProject();
  const [drawerOpen, setDrawerOpen] = useState(false);
  /**
   * The density value the user last clicked during `densityIntro`,
   * or `null` if they haven't clicked anything yet. The density
   * cards do double duty as the advance affordance: the first
   * click on a card sets the density and stamps it here; clicking
   * the *same* card again (now showing a `Continue →` chip in
   * place of `Selected ✓`) advances the journey. Resets whenever
   * we leave the spotlight stage.
   */
  const [pickedDensityThisStage, setPickedDensityThisStage] =
    useState<Density | null>(null);
  const setSetupDismissedForProject = useUIStore(
    (s) => s.setSetupDismissedForProject,
  );
  const setSetupDisengaged = useUIStore((s) => s.setSetupDisengaged);
  const setTourActive = useUIStore((s) => s.setTourActive);
  const stage = useOnboardingStageStore((s) => s.stage);
  const setStage = useOnboardingStageStore((s) => s.setStage);
  const resetStage = useOnboardingStageStore((s) => s.reset);
  const stageDef = findStageDef(stage);

  // Clear the density-picked flag whenever we leave the
  // density-spotlight stage, so a re-entry (back-button) gets a
  // fresh "pick something" feel rather than remembering an old click.
  useEffect(() => {
    if (!stageDef.showDensitySpotlight) setPickedDensityThisStage(null);
  }, [stage, stageDef.showDensitySpotlight]);

  // Auto-advance for stages with `holdMs + next`. Typewriter stages
  // advance themselves once their text finishes typing (see
  // TypewriterHero). Pause while the IntegrateDrawer is open so the
  // marquee beats (aurora arrival, postArrival nudge) don't fire
  // behind it — the user comes back from the drawer to a stage they
  // never actually saw, which feels broken.
  useEffect(() => {
    if (drawerOpen) return;
    if (stageDef.typewriter) return;
    if (!stageDef.holdMs || !stageDef.next) return;
    const next = stageDef.next;
    const t = setTimeout(() => setStage(next), stageDef.holdMs);
    return () => clearTimeout(t);
  }, [
    stage,
    stageDef.holdMs,
    stageDef.next,
    stageDef.typewriter,
    setStage,
    drawerOpen,
  ]);

  // Reset the journey on unmount so re-entry (e.g. via the toolbar's
  // "SDK connection pending" button) starts fresh from welcome.
  useEffect(() => {
    return () => {
      resetStage();
    };
  }, [resetStage]);

  const handleHideForNow = useCallback(() => {
    if (!project) return;
    setSetupDisengaged(true);
    setSetupDismissedForProject(project.id, true);
    // Also clear the tour-active override so existing customers who
    // launched the tour from the toolbar end up back at their real
    // table, not the demo on next render.
    setTourActive(false);
  }, [
    project,
    setSetupDisengaged,
    setSetupDismissedForProject,
    setTourActive,
  ]);

  const handleAdvanceManual = useCallback(() => {
    // If the user is confirming the density spotlight, persist the
    // fact so future journeys skip the densityIntro stage entirely
    // — it's a one-time preference, asking again would just be
    // friction.
    if (stageDef.showDensitySpotlight) markDensityConfirmed();
    if (stageDef.next) setStage(stageDef.next);
  }, [stageDef.next, stageDef.showDensitySpotlight, setStage]);

  // If the user has already confirmed a density in a past journey,
  // skip the spotlight stage automatically the moment we land on
  // it. We don't bypass the stage in the journey config (its
  // copy still exists for first-timers) — we just advance past
  // it on entry so the user goes straight to the aurora beat.
  useEffect(() => {
    if (!stageDef.showDensitySpotlight) return;
    if (!stageDef.next) return;
    if (!hasDensityBeenConfirmed()) return;
    setStage(stageDef.next);
  }, [stage, stageDef.showDensitySpotlight, stageDef.next, setStage]);

  // Tag `<body>` with the current stage so global CSS rules can
  // react — specifically the drawer-overview glow that highlights
  // the trace drawer while that stage is active. The drawer is
  // portaled to body, so a parent-scoped CSS rule wouldn't reach
  // it; a body-level data attribute is the simplest hook.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.tracesTourStage = stage;
    return () => {
      delete document.body.dataset.tracesTourStage;
    };
  }, [stage]);

  // Mark the journey completed the first time the user reaches the
  // outro beat. That flag flips the welcome screen on subsequent
  // visits into a small "where do you want help?" hub instead of
  // forcing them through the linear narrative again. We persist via
  // localStorage (see `markJourneyCompleted`) so it survives unmount
  // and reload; the journey itself still resets per visit.
  useEffect(() => {
    if (stage === "outro") markJourneyCompleted();
  }, [stage]);

  // Auto-open the highlighted rich-arrival trace if the user
  // doesn't click within `POST_ARRIVAL_AUTO_OPEN_MS`. The whole
  // postArrival stage is set up to nudge the click — copy says
  // "click the highlighted row," the row glimmers blue, the
  // cursor flips to a pointer — but if the user genuinely never
  // engages we just open the drawer for them so the journey
  // completes its arc instead of stalling. A real click before
  // the timer fires cancels the auto-open via cleanup.
  const openTraceDrawer = useOpenTraceDrawer();
  useEffect(() => {
    if (stage !== "postArrival") return;
    // Don't auto-open the trace drawer behind the IntegrateDrawer —
    // the user is reading SDK setup, popping a second drawer
    // underneath would be jarring and they'd miss the moment we're
    // trying to land.
    if (drawerOpen) return;
    const richTrace = ARRIVAL_PREVIEW_TRACES.find(
      (t) => t.traceId === RICH_ARRIVAL_TRACE_ID,
    );
    if (!richTrace) return;
    const t = setTimeout(
      () => openTraceDrawer(richTrace),
      POST_ARRIVAL_AUTO_OPEN_MS,
    );
    return () => clearTimeout(t);
  }, [stage, openTraceDrawer, drawerOpen]);

  // When the trace drawer opens during postArrival (whether via the
  // user clicking the highlighted row or our auto-open timer firing)
  // advance the journey to `tourGate` so the hero re-anchors to the
  // left column and offers the tour-or-skip choice.
  const { currentDrawer, closeDrawer } = useDrawer();
  useEffect(() => {
    if (stage !== "postArrival") return;
    if (currentDrawer === "traceV2Details") {
      setStage("tourGate");
    }
  }, [stage, currentDrawer, setStage]);

  // If the user lands on `tourGate` and then closes the trace drawer
  // (Esc, X, click outside) without picking either CTA, drop them
  // back to postArrival rather than leaving the "Want a quick tour?"
  // hero floating with no context. The highlighted row pulses again
  // and the user can re-engage on their own terms — re-opening any
  // sample row will land them back here naturally.
  useEffect(() => {
    if (stage !== "tourGate") return;
    if (currentDrawer !== "traceV2Details") {
      setStage("postArrival");
    }
  }, [stage, currentDrawer, setStage]);

  // Once the journey shifts the user's focus away from the drawer
  // (facetsReveal points at the left sidebar, outro is the victory
  // lap), close the drawer so the hero isn't clipped behind it.
  // Skipping the tour also lands at outro and that path never opens
  // the drawer, so this is a no-op there.
  useEffect(() => {
    if (stage !== "facetsReveal" && stage !== "outro") return;
    if (currentDrawer === "traceV2Details") {
      closeDrawer();
    }
  }, [stage, currentDrawer, closeDrawer]);

  // facetsReveal points at the facet sidebar — the actual store
  // needs to be uncollapsed (not just the visual width), otherwise
  // FilterSidebar renders its icon-only mode and the user sees a
  // strip of unclickable icons. We drive setSidebarCollapsed
  // directly so every consumer (toggle button, keyboard shortcut,
  // FilterSidebar internals) sees a consistent state. We track
  // whether *we* uncollapsed it so we only restore on exit when we
  // were the cause; if the user had it expanded already, we leave
  // it alone.
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const sidebarUncollapsedByJourney = useRef(false);
  useEffect(() => {
    const wasOpenedByJourney = sidebarUncollapsedByJourney.current;
    if (stage === "facetsReveal") {
      const collapsedNow = useUIStore.getState().sidebarCollapsed;
      if (collapsedNow && !wasOpenedByJourney) {
        sidebarUncollapsedByJourney.current = true;
        setSidebarCollapsed(false);
      }
    } else if (wasOpenedByJourney) {
      sidebarUncollapsedByJourney.current = false;
      setSidebarCollapsed(true);
    }
  }, [stage, setSidebarCollapsed]);
  useEffect(() => {
    return () => {
      if (sidebarUncollapsedByJourney.current) {
        setSidebarCollapsed(true);
      }
    };
  }, [setSidebarCollapsed]);

  const handleTypewriterDone = useCallback(() => {
    // If the stage has a manual CTA, the typewriter just stops at
    // the end of its run — the user clicks Continue / the
    // density-card chip / etc. to advance. Only auto-advance when
    // the stage explicitly opted into being a narrative beat (no
    // cta + has next).
    if (stageDef.cta) return;
    if (stageDef.next) setStage(stageDef.next);
  }, [stageDef.cta, stageDef.next, setStage]);

  if (!project || !organization) {
    return (
      <VStack flex={1} justify="center" align="center" padding={8}>
        <Text color="fg.muted">Loading project…</Text>
      </VStack>
    );
  }

  const showIntegrateCta = stageDef.showIntegrateCta !== false;

  return (
    <>
      <HotkeyBindings
        drawerOpen={drawerOpen}
        onIntegrate={() => setDrawerOpen(true)}
        onSkip={handleHideForNow}
      />

      <VStack
        align="center"
        gap={4}
        width="full"
        // The hero shrinks dramatically during the drawer-tour
        // stages — the drawer covers the right half of the viewport,
        // so anything wider than ~400px would slide under it. 380px
        // is the sweet spot: keeps the tour-gate CTAs ("Show me
        // around" + "I'll explore myself") on one line without
        // creeping toward the drawer.
        maxWidth={stageDef.heroLayout === "left" ? "380px" : "640px"}
        paddingX={{ base: 4, md: 8 }}
      >
        {/* Hero motion key is the heading text (or a hidden-stage
            sentinel). Consecutive stages that share the same
            heading keep the same key and therefore stay mounted —
            no exit/enter flicker — which lets a long beat (e.g.
            arrivalPrep → auroraArrival, sharing copy while the
            aurora plays) read as one continuous moment instead of
            a stage swap. */}
        <AnimatePresence mode="wait" initial={false}>
          {stage === "welcome" && hasCompletedJourney() ? (
            // Returning users land on the welcome beat (re-entered via the
            // toolbar's "SDK connection pending" button after dismissing
            // the empty state). Skip the linear "Welcome." → "Meet your
            // trace explorer." typewriter narrative they've already sat
            // through and offer a small jump-to-this-bit hub instead.
            <motion.div
              key="welcome-hub"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <ReturningUserHub onJump={setStage} />
            </motion.div>
          ) : stageDef.heading ? (
            <motion.div
              key={stageDef.heading}
              initial={{ opacity: 0, y: 4 }}
              // `dimHero` (currently `auroraArrival`) drops the hero
              // text to ~45% so the user's eye is pulled UP to the
              // aurora ribbon. Animates back to full opacity the
              // moment the stage advances and dimHero flips off,
              // because motion's `animate` re-targets in place.
              animate={{ opacity: stageDef.dimHero ? 0.45 : 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              {stageDef.typewriter ? (
                <TypewriterHero
                  heading={stageDef.heading}
                  subhead={stageDef.subhead}
                  lingerMs={stageDef.holdMs}
                  onDone={handleTypewriterDone}
                  paused={drawerOpen}
                />
              ) : (
                <StaticHero
                  stage={stage}
                  heading={stageDef.heading}
                  subhead={stageDef.subhead}
                />
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Tour gate — `tourGate` stage offers an explicit
            opt-in choice: take the drawer tour, or skip straight
            to the outro. Renders two CTAs side by side instead of
            the regular single-CTA footer. */}
        <AnimatePresence>
          {stage === "tourGate" && (
            <motion.div
              key="tour-gate"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* `flexWrap="nowrap"` keeps the two CTAs on one line
                  even in the narrow `left` hero column during the
                  drawer-tour stages — wrapping reads as broken
                  because the container is already a tight 380px and
                  splitting "Show me around" across two lines makes
                  it look like an afterthought. Both CTAs get matched
                  icons so the visual weight is balanced. */}
              <HStack gap={3} flexWrap="nowrap" justify="center">
                <Button
                  size="md"
                  variant="solid"
                  colorPalette="orange"
                  whiteSpace="nowrap"
                  onClick={() => setStage("drawerOverview")}
                >
                  <Compass size={14} />
                  Show me around
                </Button>
                {/* Skip drops the user straight into facets — they
                    land in a populated, filtered table with the
                    sidebar live. Faster path to the real product
                    for users who don't want hand-holding. */}
                <Button
                  size="md"
                  variant="ghost"
                  colorPalette="gray"
                  whiteSpace="nowrap"
                  onClick={() => setStage("facetsReveal")}
                >
                  I'll explore myself
                  <ArrowRight size={14} />
                </Button>
              </HStack>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Density spotlight — two side-by-side cards with multi-row
            previews (compact vs comfortable) so the user sees the
            per-row reflow at a glance. Clicking commits the density
            to the global store; the live table behind reflows too. */}
        <AnimatePresence>
          {stageDef.showDensitySpotlight && (
            <motion.div
              key="density-spotlight"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              style={{ width: "100%" }}
            >
              <DensitySpotlight
                pickedValue={pickedDensityThisStage}
                onPick={(v) => setPickedDensityThisStage(v)}
                onContinue={handleAdvanceManual}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quiet "hand this to your agent" affordance during the
            welcome beats. The narrative: by the time the user
            finishes watching the tour, their agent has done the
            integration. Surfaced only on the welcome / trace_explorer
            stages so it doesn't compete with later, more directed
            CTAs. Lands the user on the Skill tab inside the
            IntegrateDrawer (the drawer's default segment), which is
            the lightest-touch handoff path. */}
        <AnimatePresence>
          {(stage === "welcome" || stage === "trace_explorer") && (
            <motion.div
              key="agent-handoff"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{
                duration: 0.6,
                delay: 0.4,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <Button
                variant="ghost"
                size="sm"
                colorPalette="gray"
                color="fg.muted"
                _hover={{ color: "fg", bg: "bg.softHover" }}
                onClick={() => setDrawerOpen(true)}
              >
                <Wrench size={12} />
                <Text as="span">Or hand this to your coding agent</Text>
                <Text as="span" aria-hidden color="fg.subtle">
                  →
                </Text>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Primary Integrate CTA — visible per-stage via
            `showIntegrateCta`. Hidden during welcome + densityIntro
            so the user isn't reading copy / picking density next to
            a competing primary action. */}
        <AnimatePresence>
          {showIntegrateCta && (
            <motion.div
              key="integrate-cta"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{
                duration: 0.4,
                delay: 0.18,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <Button
                size="md"
                variant="solid"
                colorPalette="orange"
                onClick={() => setDrawerOpen(true)}
                paddingX={5}
              >
                <Wrench size={14} />
                Integrate my code
                <Kbd>{INTEGRATE_KEY}</Kbd>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Single footer row — manual advance CTA (when the stage
            defines one), docs link and skip, all inline. Saves the
            vertical space we'd otherwise lose to a dedicated CTA
            row above the footer, which matters most on the densest
            stage (densityIntro). The Continue button stays quiet
            until the user actually picks a density — once they
            have, it wakes up to solid orange so pressing it next
            reads as obvious. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.32 }}
        >
          <HStack
            gap={3}
            color="fg.muted"
            textStyle="xs"
            flexWrap="wrap"
            justify="center"
          >
            {/* Footer-level CTA only renders for stages that *don't*
                have the density spotlight — the spotlight cards do
                double-duty as the advance affordance there (click
                once to pick, click again to continue), so a
                separate Continue button here would just be noise. */}
            {stageDef.cta && stageDef.next && !stageDef.showDensitySpotlight && (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="gray"
                  onClick={handleAdvanceManual}
                >
                  <Text>{stageDef.cta}</Text>
                  <Text aria-hidden as="span" color="fg.muted">
                    →
                  </Text>
                </Button>
                <Text aria-hidden color="fg.subtle">
                  •
                </Text>
              </>
            )}
            <Link
              href="https://docs.langwatch.ai/integration/overview"
              isExternal
              _hover={{ color: "fg" }}
            >
              <HStack gap={1.5}>
                <Icon boxSize={3.5}>
                  <BookOpen />
                </Icon>
                <Text>Integration overview</Text>
              </HStack>
            </Link>
            <Text aria-hidden color="fg.subtle">
              •
            </Text>
            <Button
              variant="plain"
              size="xs"
              color="fg.muted"
              onClick={handleHideForNow}
              padding={0}
              minHeight="auto"
              _hover={{ color: "fg" }}
            >
              <Text>Skip for now</Text>
              <Kbd>{SKIP_KEY}</Kbd>
            </Button>
            {/* No "watch the tour again" inline at outro — the toolbar's
                Tour button (binoculars) is the canonical re-entry point.
                Keeping a second copy here was redundant and made the
                outro footer feel cluttered. */}
          </HStack>
        </motion.div>
      </VStack>

      <IntegrateDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}

interface StaticHeroProps {
  stage: StageId;
  heading: string;
  subhead?: string;
}

function StaticHero({
  stage,
  heading,
  subhead,
}: StaticHeroProps): React.ReactElement {
  return (
    <VStack align="center" gap={4} maxWidth="58ch" textAlign="center">
      <Heading
        fontSize={{ base: "3xl", md: "4xl" }}
        letterSpacing="-0.035em"
        fontWeight={400}
        lineHeight="1.05"
        color="fg"
        whiteSpace="pre-line"
      >
        {renderHeading(stage, heading)}
      </Heading>
      {subhead && (
        <Text
          color="fg.muted"
          textStyle="md"
          lineHeight="1.65"
          maxWidth="48ch"
        >
          {subhead}
        </Text>
      )}
    </VStack>
  );
}

interface TypewriterHeroProps {
  heading: string;
  subhead?: string;
  /**
   * How long to hold the fully-typed text on screen before calling
   * `onDone`. The journey config exposes this via the stage's
   * `holdMs` field — different beats want different breathing room
   * (the aurora-arrival stage wants a longer linger so the aurora
   * has time to actually play, for example).
   */
  lingerMs?: number;
  onDone: () => void;
  /**
   * When true, freeze the typing/linger machine in place — used while
   * the IntegrateDrawer is open so the marquee beats don't tick past
   * behind it. Resumes from wherever it was paused once `paused`
   * flips back to false.
   */
  paused?: boolean;
}

/**
 * Two-stage typewriter — heading types char-by-char, then a brief
 * pause, then subhead types char-by-char. Once everything is on
 * screen we linger for `TYPEWRITER_LINGER_MS` and call `onDone`
 * (which advances the journey to the next stage). A blinking
 * cursor sits at the active typing position.
 */
function TypewriterHero({
  heading,
  subhead,
  lingerMs = TYPEWRITER_LINGER_MS,
  onDone,
  paused = false,
}: TypewriterHeroProps): React.ReactElement {
  type Phase = "heading" | "gap" | "subhead" | "linger" | "done";
  const [headingShown, setHeadingShown] = useState(0);
  const [subheadShown, setSubheadShown] = useState(0);
  const [phase, setPhase] = useState<Phase>("heading");

  // Reset on prop change so a stage swap restarts the animation.
  useEffect(() => {
    setHeadingShown(0);
    setSubheadShown(0);
    setPhase("heading");
  }, [heading, subhead]);

  useEffect(() => {
    if (paused) return;
    if (phase === "heading") {
      if (headingShown >= heading.length) {
        setPhase(subhead ? "gap" : "linger");
        return;
      }
      const t = setTimeout(
        () => setHeadingShown((s) => s + 1),
        TYPEWRITER_HEADING_MS,
      );
      return () => clearTimeout(t);
    }
    if (phase === "gap") {
      const t = setTimeout(() => setPhase("subhead"), TYPEWRITER_GAP_MS);
      return () => clearTimeout(t);
    }
    if (phase === "subhead") {
      if (!subhead || subheadShown >= subhead.length) {
        setPhase("linger");
        return;
      }
      const t = setTimeout(
        () => setSubheadShown((s) => s + 1),
        TYPEWRITER_SUBHEAD_MS,
      );
      return () => clearTimeout(t);
    }
    if (phase === "linger") {
      const t = setTimeout(() => setPhase("done"), lingerMs);
      return () => clearTimeout(t);
    }
    if (phase === "done") {
      onDone();
    }
  }, [
    phase,
    headingShown,
    subheadShown,
    heading,
    subhead,
    lingerMs,
    onDone,
    paused,
  ]);

  const headingTyping = phase === "heading";
  const subheadTyping = phase === "subhead";

  return (
    <VStack align="center" gap={4} maxWidth="58ch" textAlign="center">
      <Heading
        fontSize={{ base: "3xl", md: "4xl" }}
        letterSpacing="-0.035em"
        fontWeight={400}
        lineHeight="1.05"
        color="fg"
        whiteSpace="pre-line"
      >
        {applyAuroraTextShimmer(heading.slice(0, headingShown))}
        {headingTyping && <BlinkingCursor />}
      </Heading>
      {subhead && (
        <Text
          color="fg.muted"
          textStyle="md"
          lineHeight="1.65"
          maxWidth="48ch"
          minHeight="1.65em"
        >
          {applyAuroraTextShimmer(subhead.slice(0, subheadShown))}
          {subheadTyping && <BlinkingCursor color="fg.muted" />}
        </Text>
      )}
    </VStack>
  );
}

const BlinkingCursor: React.FC<{ color?: string }> = ({ color = "fg" }) => (
  <Box
    as="span"
    aria-hidden
    display="inline-block"
    width="0.55ch"
    height="0.95em"
    marginLeft="0.05em"
    verticalAlign="-0.12em"
    backgroundColor={color}
    css={{
      animation: "tracesV2TypewriterBlink 1.05s steps(1) infinite",
      "@keyframes tracesV2TypewriterBlink": {
        "0%, 50%": { opacity: 1 },
        "50.01%, 100%": { opacity: 0 },
      },
    }}
  />
);

/**
 * Most stages render their heading verbatim. A few do special
 * inline treatments:
 *  - postArrival prepends a coloured `↑` glyph as a directional cue.
 *  - any heading that mentions the word *aurora* gets the word
 *    itself shimmered with the platform's aurora gradient — same
 *    sky/blue/cyan/indigo palette as `AuroraSvg`, animated across
 *    the text via `background-clip: text`. Reinforces the visual
 *    word the copy is teaching.
 */
function renderHeading(stage: StageId, heading: string): React.ReactNode {
  if (stage === "postArrival") {
    return (
      <>
        <Text
          as="span"
          color="blue.fg"
          fontWeight={500}
          marginRight={2}
          aria-hidden
        >
          ↑
        </Text>
        {applyAuroraTextShimmer(heading.replace(/^↑\s*/, ""))}
      </>
    );
  }
  return applyAuroraTextShimmer(heading);
}

/**
 * Wraps every standalone occurrence of `aurora` (case-insensitive)
 * in a span that animates a multi-stop gradient across the
 * background-clipped text. The original word and casing are
 * preserved; only the appearance changes.
 */
function applyAuroraTextShimmer(text: string): React.ReactNode {
  const parts = text.split(/(\baurora\b)/i);
  return parts.map((part, i) => {
    if (/^aurora$/i.test(part)) {
      return <AuroraTextShimmer key={i}>{part}</AuroraTextShimmer>;
    }
    return <span key={i}>{part}</span>;
  });
}

const AuroraTextShimmer: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Box
    as="span"
    display="inline-block"
    css={{
      backgroundImage:
        "linear-gradient(90deg, #7dd3fc, #3b82f6, #6366f1, #22d3ee, #818cf8, #7dd3fc)",
      backgroundSize: "300% 100%",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      WebkitTextFillColor: "transparent",
      animation: "tracesV2AuroraTextShimmer 5s linear infinite",
      "@keyframes tracesV2AuroraTextShimmer": {
        "0%": { backgroundPosition: "0% 50%" },
        "100%": { backgroundPosition: "300% 50%" },
      },
    }}
  >
    {children}
  </Box>
);

interface HotkeyBindingsProps {
  drawerOpen: boolean;
  onIntegrate: () => void;
  onSkip: () => void;
}

/**
 * `I` opens the integrate drawer, `K` dismisses the card. Gated on
 * `!drawerOpen` so the drawer's own S/M/P/I tab letters can claim the
 * keyboard once the user is in the integrate flow.
 */
function HotkeyBindings({
  drawerOpen,
  onIntegrate,
  onSkip,
}: HotkeyBindingsProps): null {
  useEffect(() => {
    if (drawerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === SKIP_KEY.toLowerCase()) {
        e.preventDefault();
        onSkip();
        return;
      }
      if (key === INTEGRATE_KEY.toLowerCase()) {
        e.preventDefault();
        onIntegrate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawerOpen, onIntegrate, onSkip]);
  return null;
}

interface DensityChoice {
  value: Density;
  label: string;
  hint: string;
  icon: typeof AArrowDown;
  /** Vertical gap between bars in the multi-row preview. */
  rowGap: string;
  /** Height of each preview bar — proxies "row height" visually. */
  rowHeight: string;
  /** How many bars to stack inside the preview. */
  rowCount: number;
}

const DENSITY_CHOICES: DensityChoice[] = [
  {
    value: "compact",
    label: "Compact",
    hint: "More rows on screen.",
    icon: AArrowDown,
    rowGap: "3px",
    rowHeight: "6px",
    rowCount: 5,
  },
  {
    value: "comfortable",
    label: "Comfortable",
    hint: "Room to breathe.",
    icon: AArrowUp,
    rowGap: "9px",
    rowHeight: "9px",
    rowCount: 3,
  },
];

const DensityCardButton = chakra("button", {
  base: {
    textAlign: "left",
    cursor: "pointer",
    transition: "all 160ms ease",
    width: "full",
  },
});

/**
 * Side-by-side density preview cards. Each card stacks N bars at
 * its target spacing so the per-row contrast reads at a glance —
 * "Compact" packs more rows tighter, "Comfortable" gives each row
 * breathing room. Clicking a card commits the density to the
 * global store; the live table behind reflows in real time.
 */
interface DensitySpotlightProps {
  /**
   * The density value the user has clicked during the spotlight
   * stage, or `null` if they haven't engaged yet. Click-to-pick
   * sets this; clicking the *same* card again triggers
   * `onContinue`. Lifted to the parent so the spotlight knows
   * which card to render with the `Continue →` chip.
   */
  pickedValue: Density | null;
  onPick: (value: Density) => void;
  onContinue: () => void;
}

function DensitySpotlight({
  pickedValue,
  onPick,
  onContinue,
}: DensitySpotlightProps): React.ReactElement {
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);

  const handleCardClick = (value: Density) => {
    if (value === pickedValue) {
      // Second click on the already-picked card: advance.
      onContinue();
      return;
    }
    setDensity(value);
    onPick(value);
  };

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} gap={2.5} width="full">
      {DENSITY_CHOICES.map((choice) => {
        const isActive = density === choice.value;
        const isPicked = pickedValue === choice.value;
        return (
          <DensityCardButton
            key={choice.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => handleCardClick(choice.value)}
            padding={3}
            borderRadius="lg"
            borderWidth="1px"
            borderColor={isActive ? "orange.solid" : "border.muted"}
            background={isActive ? "orange.subtle" : "bg.panel/60"}
            _hover={
              isActive
                ? undefined
                : {
                    borderColor: "border.emphasized",
                    background: "bg.panel",
                  }
            }
          >
            <VStack align="stretch" gap={2}>
              <HStack justify="space-between" align="center">
                <HStack gap={2}>
                  <Icon
                    boxSize={3.5}
                    color={isActive ? "orange.fg" : "fg.muted"}
                  >
                    <choice.icon />
                  </Icon>
                  <Text textStyle="sm" fontWeight={500} color="fg">
                    {choice.label}
                  </Text>
                </HStack>
                {isPicked ? (
                  <HStack
                    gap={1}
                    paddingX={1.5}
                    paddingY={0.5}
                    borderRadius="full"
                    background="orange.solid"
                    color="orange.contrast"
                  >
                    <Text textStyle="2xs" fontWeight={600}>
                      Continue
                    </Text>
                    <Text aria-hidden as="span" textStyle="2xs">
                      →
                    </Text>
                  </HStack>
                ) : isActive ? (
                  <HStack
                    gap={1}
                    paddingX={1.5}
                    paddingY={0.5}
                    borderRadius="full"
                    background="orange.subtle"
                    color="orange.fg"
                    borderWidth="1px"
                    borderColor="orange.muted"
                  >
                    <Icon boxSize={2.5}>
                      <Check />
                    </Icon>
                    <Text textStyle="2xs" fontWeight={600}>
                      Current
                    </Text>
                  </HStack>
                ) : null}
              </HStack>

              <DensityRowsPreview choice={choice} active={isActive} />

              <Text textStyle="2xs" color="fg.muted" lineHeight={1.4}>
                {choice.hint}
              </Text>
            </VStack>
          </DensityCardButton>
        );
      })}
    </SimpleGrid>
  );
}

interface DensityRowsPreviewProps {
  choice: DensityChoice;
  active: boolean;
}

/**
 * Multi-row preview using `FauxLine`-style bars (same visual idiom
 * as `WhatsChangedStep`). Each card uses fixed spacing per its
 * density so the side-by-side comparison is honest — Compact's
 * card shows 6 tight rows, Comfortable's shows 4 spaced rows, in
 * roughly the same vertical envelope.
 */
const DensityRowsPreview: React.FC<DensityRowsPreviewProps> = ({
  choice,
  active,
}) => (
  <Box
    borderRadius="md"
    borderWidth="1px"
    borderColor={active ? "orange.muted" : "border.muted"}
    background="bg.surface"
    paddingX={2.5}
    paddingY={2.5}
    height="92px"
    overflow="hidden"
  >
    <VStack align="stretch" gap={choice.rowGap}>
      {Array.from({ length: choice.rowCount }).map((_, i) => (
        <HStack key={i} gap={2} align="center">
          <Box
            height={choice.rowHeight}
            width="22%"
            borderRadius="sm"
            bg="border.emphasized"
            opacity={0.7}
          />
          <Box
            height={choice.rowHeight}
            flex={1}
            borderRadius="sm"
            bg="border.muted"
          />
          <Box
            height={choice.rowHeight}
            width="14%"
            borderRadius="sm"
            bg="border.muted"
          />
        </HStack>
      ))}
    </VStack>
  </Box>
);

interface HubOption {
  label: string;
  description: string;
  icon: typeof Sparkles;
  /**
   * Stage to jump into when this option is picked. We aim at the
   * *narrative entry point* rather than the climax — e.g. picking the
   * drawer tour lands at `postArrival` so the user clicks the highlighted
   * row themselves and the rest of the drawer beats fall out
   * naturally, exactly like a first-time visit. That keeps the wiring
   * (drawer-open → tourGate, tourGate-CTA → drawerOverview, etc.) on a
   * single code path; the hub just chooses which beat to start from.
   */
  target: StageId;
}

const RETURNING_USER_HUB_OPTIONS: HubOption[] = [
  {
    label: "How traces arrive",
    description: "The aurora ribbon and the live-update feel.",
    icon: Sparkles,
    target: "arrivalPrep",
  },
  {
    label: "The trace drawer",
    description: "Conversation, spans, evals — see one in detail.",
    icon: PanelRightOpen,
    target: "postArrival",
  },
  {
    label: "Filters and facets",
    description: "Slice the table by service, model, status, more.",
    icon: Filter,
    target: "facetsReveal",
  },
];

interface ReturningUserHubProps {
  onJump: (stage: StageId) => void;
}

/**
 * Welcome screen for users who've already completed the onboarding
 * journey at least once (`hasCompletedJourney()` is true). Instead of
 * making them sit through the linear narrative again, we offer a small
 * hub of "help me with that bit" jumps. Each option targets the
 * narrative entry point of the relevant beat so the rest of the journey
 * machinery stays on its existing code path.
 *
 * `Run me through the whole thing` is a fall-through to the first
 * post-`Welcome.` beat so we don't repeat the bare welcome line they
 * just saw — `trace_explorer` is the proper start of the substantive
 * tour.
 */
function ReturningUserHub({
  onJump,
}: ReturningUserHubProps): React.ReactElement {
  return (
    <VStack align="center" gap={4} maxWidth="58ch" textAlign="center">
      <Heading
        fontSize={{ base: "3xl", md: "4xl" }}
        letterSpacing="-0.035em"
        fontWeight={400}
        lineHeight="1.05"
        color="fg"
      >
        Welcome back.
      </Heading>
      <Text color="fg.muted" textStyle="md" lineHeight="1.65" maxWidth="48ch">
        Want a hand with a specific bit? Pick one — or click around the
        table.
      </Text>
      <VStack gap={2} width="full" maxWidth="380px" align="stretch">
        {RETURNING_USER_HUB_OPTIONS.map((opt) => (
          <Button
            key={opt.target}
            onClick={() => onJump(opt.target)}
            variant="outline"
            colorPalette="gray"
            justifyContent="flex-start"
            width="full"
            height="auto"
            paddingY={2.5}
            paddingX={3}
            _hover={{ borderColor: "border.emphasized", bg: "bg.panel" }}
          >
            <Icon boxSize={4} color="orange.fg">
              <opt.icon />
            </Icon>
            <VStack align="start" gap={0} flex={1}>
              <Text textStyle="sm" fontWeight={500} color="fg">
                {opt.label}
              </Text>
              <Text textStyle="xs" color="fg.muted" fontWeight={400}>
                {opt.description}
              </Text>
            </VStack>
            <Icon boxSize={3.5} color="fg.subtle">
              <ArrowRight />
            </Icon>
          </Button>
        ))}
      </VStack>
      <Button
        size="xs"
        variant="ghost"
        colorPalette="gray"
        color="fg.muted"
        onClick={() => onJump("trace_explorer")}
        _hover={{ color: "fg" }}
      >
        <Icon boxSize={3.5}>
          <Compass />
        </Icon>
        Run me through the whole thing
      </Button>
    </VStack>
  );
}
