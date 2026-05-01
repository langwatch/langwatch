import { Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft, BookOpen, RotateCcw, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Link } from "~/components/ui/link";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useOpenTraceDrawer } from "../../hooks/useOpenTraceDrawer";
import type { Density } from "../../stores/densityStore";
import { useUIStore } from "../../stores/uiStore";
import { findStageDef } from "../chapters/onboardingJourneyConfig";
import {
  ARRIVAL_PREVIEW_TRACES,
  RICH_ARRIVAL_TRACE_ID,
} from "../data/samplePreviewTraces";
import {
  hasCompletedJourney,
  hasDensityBeenConfirmed,
  markDensityConfirmed,
  markJourneyCompleted,
  useOnboardingStore,
} from "../store/onboardingStore";
import { BeadStrip } from "./BeadStrip";
import { DensitySpotlight } from "./DensitySpotlight";
import { HotkeyBindings } from "./HotkeyBindings";
import { IntegrateDrawer } from "./IntegrateDrawer";
import { OutroPanel } from "./OutroPanel";
import { ReturningUserHub } from "./ReturningUserHub";
import { StaticHero } from "./StaticHero";
import { TypewriterHero } from "./TypewriterHero";

// Was 8s — too punchy. The highlighted row is *the* invitation moment of
// the whole journey, and 8s reads as "tap or we'll do it for you" rather
// than "explore at your own pace." 14s gives the user time to actually
// read the heading + subhead, notice the row glimmer, hover, and click
// because they want to — auto-open is a fallback for genuinely
// disengaged users, not the default path.
const POST_ARRIVAL_AUTO_OPEN_MS = 14000;

const INTEGRATE_KEY = "I";
const SKIP_KEY = "K";

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
  const setSetupDismissedForProject = useOnboardingStore(
    (s) => s.setSetupDismissedForProject,
  );
  const setSetupDisengaged = useOnboardingStore((s) => s.setSetupDisengaged);
  const setTourActive = useOnboardingStore((s) => s.setTourActive);
  const stage = useOnboardingStore((s) => s.stage);
  const setStage = useOnboardingStore((s) => s.setStage);
  const resetStage = useOnboardingStore((s) => s.reset);
  const goBack = useOnboardingStore((s) => s.goBack);
  const replayStage = useOnboardingStore((s) => s.replayStage);
  const replayToken = useOnboardingStore((s) => s.replayToken);
  const history = useOnboardingStore((s) => s.history);
  const stageDef = findStageDef(stage);
  // Back is only meaningful once we've left the silent settle beat —
  // the welcome typewriter is technically the journey's first
  // user-facing stage, so anything before it shouldn't trap the user
  // in a back-button loop.
  const canGoBack = history.length > 0 && stage !== "settle";

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
  }, [project, setSetupDisengaged, setSetupDismissedForProject, setTourActive]);

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

  // (The body data attribute that drives the drawer/sidebar glow
  // CSS now lives in `OnboardingHost` via `BodyStageAttribute`.)

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
  // advance the journey straight to the `drawerOverview` chapter —
  // the drawer is the climax of the journey now, not an optional
  // detour, so there's no tour gate in the middle.
  const { currentDrawer, closeDrawer } = useDrawer();
  useEffect(() => {
    if (stage !== "postArrival") return;
    if (currentDrawer === "traceV2Details") {
      setStage("drawerOverview");
    }
  }, [stage, currentDrawer, setStage]);

  // If the user closes the trace drawer mid-`drawerOverview` (Esc /
  // X / click outside), drop them back to `postArrival` so the
  // highlighted row pulses again — re-opening any sample row lands
  // them back in `drawerOverview`. Without this, closing the drawer
  // would strand the user on a hero pointing at "the substance"
  // with nothing on the right.
  useEffect(() => {
    if (stage !== "drawerOverview") return;
    if (currentDrawer !== "traceV2Details") {
      setStage("postArrival");
    }
  }, [stage, currentDrawer, setStage]);

  // Once the journey reaches the outro, close the drawer so the
  // hero isn't clipped behind it. The outro is the victory-lap
  // chapter and renders the OutroPanel on a centred hero.
  useEffect(() => {
    if (stage !== "outro") return;
    if (currentDrawer === "traceV2Details") {
      closeDrawer();
    }
  }, [stage, currentDrawer, closeDrawer]);

  // The slice chapter (serviceSegue + facetsReveal) points at the
  // facet sidebar — the store needs to be uncollapsed (not just the
  // visual width), otherwise FilterSidebar renders icon-only mode
  // and the user sees a strip of unclickable icons. We drive
  // setSidebarCollapsed directly so every consumer (toggle button,
  // keyboard shortcut, FilterSidebar internals) sees a consistent
  // state. We track whether *we* uncollapsed it so we only restore
  // on exit when we were the cause; if the user had it expanded
  // already, we leave it alone.
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const sidebarUncollapsedByJourney = useRef(false);
  const isSliceStage = stage === "serviceSegue" || stage === "facetsReveal";
  useEffect(() => {
    const wasOpenedByJourney = sidebarUncollapsedByJourney.current;
    if (isSliceStage) {
      const collapsedNow = useUIStore.getState().sidebarCollapsed;
      if (collapsedNow && !wasOpenedByJourney) {
        sidebarUncollapsedByJourney.current = true;
        setSidebarCollapsed(false);
      }
    } else if (wasOpenedByJourney) {
      sidebarUncollapsedByJourney.current = false;
      setSidebarCollapsed(true);
    }
  }, [isSliceStage, setSidebarCollapsed]);
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
  // Returning users who completed the journey already see the welcome
  // beat as a quiet hub of jump-to-this-bit cards — strip the
  // surrounding chrome (agent-handoff CTA, Replay, Integration
  // overview link) so the hub reads as the single thing on screen.
  const isReturningWelcome = stage === "welcome" && hasCompletedJourney();

  return (
    <>
      <HotkeyBindings
        drawerOpen={drawerOpen}
        integrateKey={INTEGRATE_KEY}
        skipKey={SKIP_KEY}
        onIntegrate={() => setDrawerOpen(true)}
        onSkip={handleHideForNow}
      />

      <VStack
        align="center"
        gap={4}
        width="full"
        // Left-anchored hero (drawer-overview chapter) was 380px and
        // the subhead — "Conversation, spans, evals — it's all in
        // here. Take your time, then we'll wrap up." — wrapped into
        // a squashed three-line block. 460px gives the subhead room
        // to breathe on two lines while still leaving the
        // drawer-anchored padding logic in `EmptyStateOverlay` enough
        // slack on narrower viewports (the Flex container's
        // paddingRight = viewport - drawerLeft caps the visible
        // canvas, so this maxWidth only kicks in when there's space).
        maxWidth={stageDef.heroLayout === "left" ? "460px" : "640px"}
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
              // Including `replayToken` in the key is what makes the
              // Replay button work: bumping the token forces this
              // node to remount, which in turn restarts the
              // typewriter (or the static hero's enter animation)
              // even when the heading text and stage haven't
              // changed. Stage transitions still get clean exits
              // because the heading text changes alongside.
              key={`${stageDef.heading}__${replayToken}`}
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

        {/* Auto-click countdown — visible during postArrival so the
            user can see when we'll open the drawer for them if they
            don't engage. Hidden behind IntegrateDrawer (the timer
            also pauses there in the effect above). Pure presentation
            keyed off the same constant the timer uses, so they can't
            drift. */}
        <AnimatePresence>
          {stage === "postArrival" && !drawerOpen && (
            <motion.div
              key="post-arrival-countdown"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.6 }}
            >
              <PostArrivalCountdown totalMs={POST_ARRIVAL_AUTO_OPEN_MS} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Outro panel — terminal chapter. Replaces the old "That's
            the tour." typewriter hero with a compact panel of three
            highlight cards (multiplayer, shortcuts, integrate) plus
            the exit CTAs. Absorbs the role the standalone "What's-
            new" dialog used to play, so all post-tour content lives
            in one place at the end of the journey. */}
        <AnimatePresence>
          {stage === "outro" && (
            <motion.div
              key="outro-panel"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              style={{ width: "100%" }}
            >
              <OutroPanel
                onIntegrate={() => setDrawerOpen(true)}
                onDone={handleHideForNow}
                onRewatch={resetStage}
              />
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
          {(stage === "welcome" || stage === "trace_explorer") &&
            !isReturningWelcome && (
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

        {/* Primary "advance" CTA — promoted out of the secondary
            footer row so it actually reads as the next thing to do.
            Was previously a small ghost button inline with docs/skip,
            which got lost ("Got it" / "Show me" looked like a quiet
            label rather than the primary action). Renders as a
            solid orange button keyed to the stage so each beat
            animates in fresh. Skipped on the density spotlight (the
            cards do double-duty as the advance affordance) and the
            outro chapter (the OutroPanel owns its own CTAs). */}
        <AnimatePresence>
          {stageDef.cta &&
            stageDef.next &&
            !stageDef.showDensitySpotlight &&
            stage !== "outro" && (
              <motion.div
                key={`stage-cta-${stage}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{
                  duration: 0.35,
                  delay: 0.22,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <Button
                  size="md"
                  variant="solid"
                  colorPalette="orange"
                  onClick={handleAdvanceManual}
                  paddingX={5}
                >
                  <Text>{stageDef.cta}</Text>
                  <Text aria-hidden as="span">
                    →
                  </Text>
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
            {/* Back + Replay sit before Continue / docs / skip — they
                give the user a way out of "I missed that beat" without
                forcing them to restart the whole tour. Hidden on the
                density spotlight (its cards already double as advance
                affordances) and the outro (the OutroPanel owns its own
                CTAs there). The bullet separators are only rendered
                when an item is shown so we don't get adjacent dots. */}
            {!stageDef.showDensitySpotlight &&
              stage !== "outro" &&
              !isReturningWelcome && (
              <>
                {canGoBack && (
                  <>
                    <Button
                      size="xs"
                      variant="ghost"
                      colorPalette="gray"
                      onClick={goBack}
                      aria-label="Previous beat"
                    >
                      <Icon boxSize={3.5}>
                        <ArrowLeft />
                      </Icon>
                      <Text>Back</Text>
                    </Button>
                    <Text aria-hidden color="fg.subtle">
                      •
                    </Text>
                  </>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="gray"
                  onClick={replayStage}
                  aria-label="Replay this beat"
                >
                  <Icon boxSize={3.5}>
                    <RotateCcw />
                  </Icon>
                  <Text>Replay</Text>
                </Button>
                <Text aria-hidden color="fg.subtle">
                  •
                </Text>
              </>
            )}
            {/* Stage-level "advance" CTA used to live here as a quiet
                ghost button. It's been promoted into a solid primary
                button above the footer so the next action is
                actually obvious — the footer is now reserved for
                secondary affordances (Back / Replay / Docs / Skip)
                only. */}
            {!isReturningWelcome && (
              <>
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
              </>
            )}
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

        {/* Chapter progress strip — sits at the bottom of the hero
            stack, beneath the docs / skip secondary controls, so it
            reads as a quiet "where am I in this" indicator rather
            than competing with the primary CTA. Hidden on `settle`
            (no narrative beat has landed yet) so it doesn't appear
            before the journey is acknowledged. The strip itself is
            non-clickable — chapter jumping is offered separately
            via `ReturningUserHub` for users who've already done the
            tour once. */}
        {stage !== "settle" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            <BeadStrip stage={stage} />
          </motion.div>
        )}
      </VStack>

      <IntegrateDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}

/**
 * Visible countdown for the postArrival auto-click. Renders a small
 * "We'll open it for you in {n}s" line so the user understands the
 * journey will advance even if they don't click — it stops feeling
 * like the tour stalled. Mounts only during `postArrival` (the
 * caller gates this); when it unmounts the timer goes with it.
 *
 * The component owns its own `setInterval` and re-mounts whenever
 * postArrival re-enters (Back button → re-forward, replayStage,
 * etc.), so the countdown always starts fresh from `totalMs` even
 * though the orchestrator's auto-open `setTimeout` resets the same
 * way. They don't share a clock — they share a constant — but both
 * stop the moment the stage changes, so visible progress and actual
 * fire never drift more than a tick.
 */
const PostArrivalCountdown: React.FC<{ totalMs: number }> = ({ totalMs }) => {
  const [remainingMs, setRemainingMs] = useState(totalMs);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const next = Math.max(0, totalMs - elapsed);
      setRemainingMs(next);
      if (next <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [totalMs]);
  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <Text textStyle="xs" color="fg.muted" textAlign="center">
      Or we&apos;ll open it for you in {seconds}s.
    </Text>
  );
};
