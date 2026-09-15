import { Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft, BookOpen, RotateCcw, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Kbd } from "@langwatch/ops-web/surfaces/keyboard-key";
import { Link } from "../../../blocks/link.tsx";
import { useDrawer } from "../../../../behavior/use-drawer.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { useOpenTraceDrawer } from "../hooks/use-open-trace-drawer.ts";
import type { Density } from "../../../../behavior/density.store.ts";
import { useUIStore } from "../../../../behavior/ui.store.ts";
import {
  findStageDef,
  type HeroLayout,
} from "../../../../model/explorer/onboarding/chapters/onboarding-journey-config.ts";
import { ARRIVAL_PREVIEW_TRACES, RICH_ARRIVAL_TRACE_ID } from "./data/sample-preview-traces.ts";
import {
  hasCompletedJourney,
  hasDensityBeenConfirmed,
  markDensityConfirmed,
  markJourneyCompleted,
  useOnboardingStore,
} from "../../../../behavior/explorer/onboarding/store/onboarding-store.ts";
import { BeadStrip } from "../../../elements/explorer/onboarding/bead-strip.tsx";
import { DensitySpotlight } from "./density-spotlight.tsx";
import { HotkeyBindings } from "../../../elements/explorer/onboarding/hotkey-bindings.tsx";
import { IntegrateDrawer } from "./integrate-drawer.tsx";
import { OutroPanel } from "../../../elements/explorer/onboarding/outro-panel.tsx";
import { ReturningUserHub } from "../../../elements/explorer/onboarding/returning-user-hub.tsx";
import { StaticHero } from "../../../blocks/explorer/onboarding/static-hero.tsx";
import { TypewriterHero } from "../../../blocks/explorer/onboarding/typewriter-hero.tsx";
import { nowInstant } from "@langwatch/time";

/** How wide the hero copy runs in each of the journey's four layouts. */
const HERO_MAX_WIDTH: Record<HeroLayout, string> = {
  bottomCentre: "640px",
  centre: "640px",
  left: "460px",
  topBanner: "820px",
};

// Was 8s — too punchy.
const POST_ARRIVAL_AUTO_OPEN_MS = 14000;

const INTEGRATE_KEY = "I";
const SKIP_KEY = "K";

/**
 * Empty-state onboarding for the new Traces page.
 */
export function TracesEmptyOnboarding(): React.ReactElement {
  const { project, organization } = useOrganizationTeamProject();
  const [drawerOpen, setDrawerOpen] = useState(false);
  /**
   * The density value the user last clicked during `densityIntro`, or `null` if they
   * haven't clicked anything yet.
   */
  const [pickedDensityThisStage, setPickedDensityThisStage] = useState<Density | null>(null);
  const setSetupDismissedForProject = useOnboardingStore((s) => s.setSetupDismissedForProject);
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
  const showDensitySpotlight = !!stageDef.showDensitySpotlight;
  useEffect(() => {
    if (!showDensitySpotlight) setPickedDensityThisStage(null);
  }, [stage, showDensitySpotlight]);

  // Auto-advance for stages with `holdMs + next`. Typewriter stages advance themselves
  // once their text finishes typing (see TypewriterHero).
  useEffect(
    () => scheduleStageAdvance({ drawerOpen, setStage, stageDef }),
    [stage, stageDef.holdMs, stageDef.next, stageDef.typewriter, setStage, drawerOpen],
  );

  // Reset the journey on unmount so re-entry (e.g. via the toolbar's
  // "SDK connection pending" button) starts fresh from welcome.
  useEffect(() => {
    return () => {
      resetStage();
    };
  }, [resetStage]);

  const handleHideForNow = useCallback(
    () =>
      dismissJourney({
        projectId: project?.id,
        setSetupDisengaged,
        setSetupDismissedForProject,
        setTourActive,
      }),
    [project, setSetupDisengaged, setSetupDismissedForProject, setTourActive],
  );

  const handleAdvanceManual = useCallback(
    () => advanceStageManually({ setStage, stageDef }),
    [stageDef.next, stageDef.showDensitySpotlight, setStage],
  );

  // If the user has already confirmed a density in a past journey,
  // skip the spotlight stage automatically the moment we land on
  // it. We don't bypass the stage in the journey config (its
  // copy still exists for first-timers) — we just advance past
  // it on entry so the user goes straight to the aurora beat.
  useEffect(() => {
    skipConfirmedDensityStage({ setStage, stageDef });
  }, [stage, stageDef.showDensitySpotlight, stageDef.next, setStage]);

  // (The body data attribute that drives the drawer/sidebar glow
  // CSS now lives in `OnboardingHost` via `BodyStageAttribute`.)

  // Mark the journey completed the first time the user reaches the outro beat. That
  // flag flips the welcome screen on subsequent visits into a small "where do you want
  // help?" hub instead of forcing them through the linear narrative again.
  useEffect(() => {
    if (stage === "outro") markJourneyCompleted();
  }, [stage]);

  // Auto-open the highlighted rich-arrival trace if the user doesn't click within
  // `POST_ARRIVAL_AUTO_OPEN_MS`.
  const openTraceDrawer = useOpenTraceDrawer();
  useEffect(
    () => scheduleRichTraceAutoOpen({ drawerOpen, openTraceDrawer, stage }),
    [stage, openTraceDrawer, drawerOpen],
  );

  // When the trace drawer opens during postArrival (whether via the
  // user clicking the highlighted row or our auto-open timer firing)
  // advance the journey straight to the `drawerOverview` chapter —
  // the drawer is the climax of the journey now, not an optional
  // detour, so there's no tour gate in the middle.
  const { currentDrawer, closeDrawer } = useDrawer();
  const drawerIsOpen = currentDrawer === "traceV2Details";
  useEffect(() => {
    syncStageWithDrawer({ closeDrawer, drawerIsOpen, setStage, stage });
  }, [stage, drawerIsOpen, setStage, closeDrawer]);

  // If the user closes the trace drawer mid-`drawerOverview` (Esc / X / click outside),
  // drop them back to `postArrival` so the highlighted row pulses again — re-opening
  // any sample row lands them back in `drawerOverview`.

  // Once the journey reaches the outro, close the drawer so the
  // hero isn't clipped behind it. The outro is the victory-lap
  // chapter and renders the OutroPanel on a centred hero.

  // The slice chapter (serviceSegue + facetsReveal) points at the facet sidebar — the
  // store needs to be uncollapsed (not just the visual width), otherwise FilterSidebar
  // renders icon-only mode and the user sees a strip of unclickable icons.
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const sidebarUncollapsedByJourney = useRef(false);
  const isSliceStage = stage === "serviceSegue" || stage === "facetsReveal";
  useEffect(() => {
    syncSidebarForSliceStage({ isSliceStage, setSidebarCollapsed, sidebarUncollapsedByJourney });
  }, [isSliceStage, setSidebarCollapsed]);
  useEffect(
    () => () => restoreSidebarOnExit({ setSidebarCollapsed, sidebarUncollapsedByJourney }),
    [setSidebarCollapsed],
  );

  const handleTypewriterDone = useCallback(
    () => advanceAfterTypewriter({ setStage, stageDef }),
    [stageDef.cta, stageDef.next, setStage],
  );

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
  // The linear narrative beat: one keyed hero per heading, so consecutive
  // stages sharing a heading stay mounted instead of flickering.
  const headingHero = headingHeroElement({
    drawerOpen,
    onTypewriterDone: handleTypewriterDone,
    replayToken,
    stage,
    stageDef,
  });

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
        // Left-anchored hero (drawer-overview chapter) was 380px and the subhead —
        // "Conversation, spans, evals — it's all in here. Take your time, then we'll
        // wrap up." — wrapped into a squashed three-line block.
        maxWidth={HERO_MAX_WIDTH[stageDef.heroLayout ?? "centre"]}
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
          {heroForStage({ headingHero, setStage, stage })}
        </AnimatePresence>

        {/* Auto-click countdown — visible during postArrival so the
            user can see when we'll open the drawer for them if they
            don't engage. Hidden behind IntegrateDrawer (the timer
            also pauses there in the effect above). Pure presentation
            keyed off the same constant the timer uses, so they can't
            drift. */}
        <PostArrivalHint drawerOpen={drawerOpen} stage={stage} />

        {/* Outro panel — terminal chapter. Replaces the old "That's
            the tour." typewriter hero with a compact panel of three
            highlight cards (multiplayer, shortcuts, integrate) plus
            the exit CTAs. Absorbs the role the standalone "What's-
            new" dialog used to play, so all post-tour content lives
            in one place at the end of the journey. */}
        <OutroBanner
          onDone={handleHideForNow}
          onIntegrate={() => setDrawerOpen(true)}
          onRewatch={resetStage}
          stage={stage}
        />

        {/* Density spotlight — two side-by-side cards with multi-row
            previews (compact vs comfortable) so the user sees the
            per-row reflow at a glance. Clicking commits the density
            to the global store; the live table behind reflows too. */}
        <DensitySpotlightBeat
          onContinue={handleAdvanceManual}
          onPick={setPickedDensityThisStage}
          pickedValue={pickedDensityThisStage}
          showDensitySpotlight={!!stageDef.showDensitySpotlight}
        />

        {/* Quiet "hand this to your agent" affordance, surfaced only on the welcome/trace_explorer
            stages so it doesn't compete with later, more directed CTAs. */}
        <AgentHandoffLink
          isReturningWelcome={isReturningWelcome}
          onIntegrate={() => setDrawerOpen(true)}
          stage={stage}
        />

        {/* Primary Integrate CTA — visible per-stage via
            `showIntegrateCta`. Hidden during welcome + densityIntro
            so the user isn't reading copy / picking density next to
            a competing primary action. */}
        <IntegrateCta onIntegrate={() => setDrawerOpen(true)} showIntegrateCta={showIntegrateCta} />

        {/* Primary "advance" CTA, keyed to the stage so each beat animates in fresh. Skipped on the
            density spotlight (cards double as the CTA) and outro (owns its own CTAs). */}
        <StageAdvanceCta onAdvance={handleAdvanceManual} stage={stage} stageDef={stageDef} />

        {/* Single footer row (CTA, docs link, skip) saves vertical space over a dedicated CTA row.
            Suppressed on outro, whose top banner owns its own primary + dismiss controls. */}
        {stage !== "outro" && (
          <JourneyFooter
            canGoBack={canGoBack}
            goBack={goBack}
            isReturningWelcome={isReturningWelcome}
            onHideForNow={handleHideForNow}
            replayStage={replayStage}
            showDensitySpotlight={!!stageDef.showDensitySpotlight}
          />
        )}

        {/* Chapter progress strip: a quiet "where am I" indicator, non-clickable (chapter jumping
            lives in `ReturningUserHub`). Hidden on `settle` and `outro`. */}
        <ChapterProgress stage={stage} />
      </VStack>

      <IntegrateDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}

/**
 * Visible countdown for the postArrival auto-click. Renders a small "We'll open it for
 * you in {n}s" line so the user understands the journey will advance even if they don't
 * click — it stops feeling like the tour stalled.
 */
const PostArrivalCountdown: React.FC<{ totalMs: number }> = ({ totalMs }) => {
  const [remainingMs, setRemainingMs] = useState(totalMs);
  useEffect(() => {
    const start = nowInstant().epochMilliseconds;
    const id = window.setInterval(() => {
      const elapsed = nowInstant().epochMilliseconds - start;
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

type Stage = ReturnType<typeof useOnboardingStore.getState>["stage"];
type StageDef = ReturnType<typeof findStageDef>;
type SetStage = ReturnType<typeof useOnboardingStore.getState>["setStage"];

/**
 * Auto-advance for stages carrying `holdMs + next`. Typewriter stages advance
 * themselves once their text finishes typing (see TypewriterHero).
 */
function scheduleStageAdvance({
  drawerOpen,
  setStage,
  stageDef,
}: {
  drawerOpen: boolean;
  setStage: SetStage;
  stageDef: StageDef;
}): (() => void) | undefined {
  if (drawerOpen || stageDef.typewriter) return undefined;
  const { holdMs, next } = stageDef;
  if (!holdMs || !next) return undefined;
  const t = setTimeout(() => setStage(next), holdMs);
  return () => clearTimeout(t);
}

/**
 * A density confirmed in a past journey skips the spotlight stage the moment the
 * reader lands on it. The stage stays in the journey config — its copy still
 * exists for first-timers — it is only advanced past on entry, so the reader
 * goes straight to the aurora beat.
 */
function skipConfirmedDensityStage({
  setStage,
  stageDef,
}: {
  setStage: SetStage;
  stageDef: StageDef;
}): void {
  if (!stageDef.showDensitySpotlight || !stageDef.next) return;
  if (!hasDensityBeenConfirmed()) return;
  setStage(stageDef.next);
}

/**
 * Opens the highlighted rich-arrival trace when nothing is clicked within
 * `POST_ARRIVAL_AUTO_OPEN_MS`. Never behind the IntegrateDrawer: the reader is
 * on SDK setup there, and a second drawer popping underneath would be jarring
 * and cost them the moment.
 */
function scheduleRichTraceAutoOpen({
  drawerOpen,
  openTraceDrawer,
  stage,
}: {
  drawerOpen: boolean;
  openTraceDrawer: ReturnType<typeof useOpenTraceDrawer>;
  stage: Stage;
}): (() => void) | undefined {
  if (stage !== "postArrival" || drawerOpen) return undefined;
  const richTrace = ARRIVAL_PREVIEW_TRACES.find((t) => t.traceId === RICH_ARRIVAL_TRACE_ID);
  if (!richTrace) return undefined;
  const t = setTimeout(() => openTraceDrawer(richTrace), POST_ARRIVAL_AUTO_OPEN_MS);
  return () => clearTimeout(t);
}

/**
 * The slice chapter points at the facet sidebar, which the store has to have
 * uncollapsed — not merely the visual width — or FilterSidebar renders icon-only
 * mode and the reader gets a strip of unclickable icons.
 */
function syncSidebarForSliceStage({
  isSliceStage,
  setSidebarCollapsed,
  sidebarUncollapsedByJourney,
}: {
  isSliceStage: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarUncollapsedByJourney: { current: boolean };
}): void {
  const wasOpenedByJourney = sidebarUncollapsedByJourney.current;
  if (!isSliceStage) {
    if (!wasOpenedByJourney) return;
    sidebarUncollapsedByJourney.current = false;
    setSidebarCollapsed(true);
    return;
  }
  if (wasOpenedByJourney || !useUIStore.getState().sidebarCollapsed) return;
  sidebarUncollapsedByJourney.current = true;
  setSidebarCollapsed(false);
}

/** Puts the sidebar back the way it was found when the journey ends. */
function restoreSidebarOnExit({
  setSidebarCollapsed,
  sidebarUncollapsedByJourney,
}: {
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarUncollapsedByJourney: { current: boolean };
}): void {
  if (sidebarUncollapsedByJourney.current) setSidebarCollapsed(true);
}

/**
 * A stage with a manual call to action just stops when the typewriter finishes:
 * the reader clicks Continue, or the density chip, to advance. Only a stage that
 * opted into being a narrative beat — no cta, and a next — advances itself.
 */
function advanceAfterTypewriter({
  setStage,
  stageDef,
}: {
  setStage: SetStage;
  stageDef: StageDef;
}): void {
  if (stageDef.cta || !stageDef.next) return;
  setStage(stageDef.next);
}

/**
 * Confirming the density spotlight persists the choice, so a future journey
 * skips the densityIntro stage entirely: it is a one-time preference, and asking
 * again would just be friction.
 */
function advanceStageManually({
  setStage,
  stageDef,
}: {
  setStage: SetStage;
  stageDef: StageDef;
}): void {
  if (stageDef.showDensitySpotlight) markDensityConfirmed();
  if (stageDef.next) setStage(stageDef.next);
}

/**
 * One footer row — Back, Replay, the docs link and Skip — which saves vertical
 * space over a dedicated call-to-action row. The bullet separators only render
 * beside an item that is shown, so no two dots ever sit together.
 */
function JourneyFooter({
  canGoBack,
  goBack,
  isReturningWelcome,
  onHideForNow,
  replayStage,
  showDensitySpotlight,
}: {
  canGoBack: boolean;
  goBack: () => void;
  isReturningWelcome: boolean;
  onHideForNow: () => void;
  replayStage: () => void;
  showDensitySpotlight: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.32 }}
    >
      <HStack gap={3} color="fg.muted" textStyle="xs" flexWrap="wrap" justify="center">
        {/* Back + Replay let the user recover a missed beat without restarting the tour.
          Bullet separators only render when an item is shown, to avoid adjacent dots. */}
        {!showDensitySpotlight && !isReturningWelcome && (
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
          onClick={onHideForNow}
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
  );
}

/** The countdown shown while the journey waits for a click on the highlighted row. */
function PostArrivalHint({ drawerOpen, stage }: { drawerOpen: boolean; stage: string }) {
  return (
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
  );
}

/** The terminal chapter's panel, which owns its own primary and dismiss controls. */
function OutroBanner({
  onDone,
  onIntegrate,
  onRewatch,
  stage,
}: {
  onDone: () => void;
  onIntegrate: () => void;
  onRewatch: () => void;
  stage: Stage;
}) {
  return (
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
          <OutroPanel onIntegrate={onIntegrate} onDone={onDone} onRewatch={onRewatch} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The density beat: two side-by-side cards the reader picks between. */
function DensitySpotlightBeat({
  onContinue,
  onPick,
  pickedValue,
  showDensitySpotlight,
}: {
  onContinue: () => void;
  onPick: (density: Density) => void;
  pickedValue: Density | null;
  showDensitySpotlight: boolean;
}) {
  return (
    <AnimatePresence>
      {showDensitySpotlight && (
        <motion.div
          key="density-spotlight"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          style={{ width: "100%" }}
        >
          <DensitySpotlight pickedValue={pickedValue} onPick={onPick} onContinue={onContinue} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The quiet "hand this to your agent" affordance, on the welcome beats only. */
function AgentHandoffLink({
  isReturningWelcome,
  onIntegrate,
  stage,
}: {
  isReturningWelcome: boolean;
  onIntegrate: () => void;
  stage: Stage;
}) {
  return (
    <AnimatePresence>
      {(stage === "welcome" || stage === "trace_explorer") && !isReturningWelcome && (
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
            onClick={onIntegrate}
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
  );
}

/** The primary Integrate call to action, shown per stage. */
function IntegrateCta({
  onIntegrate,
  showIntegrateCta,
}: {
  onIntegrate: () => void;
  showIntegrateCta: boolean;
}) {
  return (
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
            onClick={onIntegrate}
            paddingX={5}
          >
            <Wrench size={14} />
            Integrate my code
            <Kbd>{INTEGRATE_KEY}</Kbd>
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The primary advance call to action, keyed to the stage so each beat animates in fresh. */
function StageAdvanceCta({
  onAdvance,
  stage,
  stageDef,
}: {
  onAdvance: () => void;
  stage: Stage;
  stageDef: StageDef;
}) {
  return (
    <AnimatePresence>
      {stageDef.cta && stageDef.next && !stageDef.showDensitySpotlight && stage !== "outro" && (
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
          <Button size="md" variant="solid" colorPalette="orange" onClick={onAdvance} paddingX={5}>
            <Text>{stageDef.cta}</Text>
            <Text aria-hidden as="span">
              →
            </Text>
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The linear narrative beat: one keyed hero per heading, so consecutive stages
 * sharing a heading stay mounted instead of flickering.
 */
function headingHeroElement({
  drawerOpen,
  onTypewriterDone,
  replayToken,
  stage,
  stageDef,
}: {
  drawerOpen: boolean;
  onTypewriterDone: () => void;
  replayToken: number;
  stage: Stage;
  stageDef: StageDef;
}): React.ReactNode {
  return stageDef.heading ? (
    <motion.div
      // `replayToken` in the key makes Replay work: bumping it remounts this node and
      // restarts the enter animation even when the heading and stage haven't changed.
      key={`${stageDef.heading}__${replayToken}`}
      initial={{ opacity: 0, y: 4 }}
      // `dimHero` (currently `auroraArrival`) drops the hero text to ~45% so the
      // user's eye is pulled UP to the aurora ribbon. Animates back to full
      // opacity the moment the stage advances and dimHero flips off, because
      // motion's `animate` re-targets in place.
      animate={{ opacity: stageDef.dimHero ? 0.45 : 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {stageDef.typewriter ? (
        <TypewriterHero
          heading={stageDef.heading}
          subhead={stageDef.subhead}
          lingerMs={stageDef.holdMs}
          onDone={onTypewriterDone}
          paused={drawerOpen}
        />
      ) : (
        <StaticHero stage={stage} heading={stageDef.heading} subhead={stageDef.subhead} />
      )}
    </motion.div>
  ) : null;
}

/**
 * Returning readers land on the welcome beat, re-entered through the toolbar's
 * "SDK connection pending" button after dismissing the empty state. They skip
 * the linear typewriter narrative they have already sat through and get a small
 * jump-to-this-bit hub instead.
 */
function heroForStage({
  headingHero,
  setStage,
  stage,
}: {
  headingHero: React.ReactNode;
  setStage: SetStage;
  stage: Stage;
}): React.ReactNode {
  if (stage !== "welcome" || !hasCompletedJourney()) return headingHero;
  return (
    <motion.div
      key="welcome-hub"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <ReturningUserHub onJump={setStage} />
    </motion.div>
  );
}

/**
 * Leaves the journey for good. The tour-active override is cleared too, so a
 * customer who launched the tour from the toolbar lands back on their real
 * table rather than the demo on the next render.
 */
function dismissJourney({
  projectId,
  setSetupDisengaged,
  setSetupDismissedForProject,
  setTourActive,
}: {
  projectId: string | undefined;
  setSetupDisengaged: (disengaged: boolean) => void;
  setSetupDismissedForProject: (projectId: string, dismissed: boolean) => void;
  setTourActive: (active: boolean) => void;
}): void {
  if (!projectId) return;
  setSetupDisengaged(true);
  setSetupDismissedForProject(projectId, true);
  setTourActive(false);
}

/**
 * Chapter progress strip: a quiet "where am I" indicator, not clickable —
 * chapter jumping lives in `ReturningUserHub`. Hidden on `settle` and `outro`.
 */
function ChapterProgress({ stage }: { stage: Stage }) {
  if (stage === "settle" || stage === "outro") return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.25 }}
    >
      <BeadStrip stage={stage} />
    </motion.div>
  );
}

/**
 * The drawer is the climax of the journey, not an optional detour, so opening it
 * during `postArrival` — by clicking the highlighted row or by the auto-open
 * timer — advances straight to `drawerOverview`, and closing it mid-chapter
 * drops back so the highlighted row pulses again. At the outro the drawer is
 * closed outright, since that chapter renders its panel on a centred hero the
 * drawer would clip.
 */
function syncStageWithDrawer({
  closeDrawer,
  drawerIsOpen,
  setStage,
  stage,
}: {
  closeDrawer: () => void;
  drawerIsOpen: boolean;
  setStage: SetStage;
  stage: Stage;
}): void {
  if (stage === "postArrival" && drawerIsOpen) return setStage("drawerOverview");
  if (stage === "drawerOverview" && !drawerIsOpen) return setStage("postArrival");
  if (stage === "outro" && drawerIsOpen) closeDrawer();
}
