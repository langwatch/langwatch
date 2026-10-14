import { ActivityTimeline } from "@langwatch/design-system/activity-timeline";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { Drawer, type DrawerFooterProps } from "@langwatch/design-system/drawer";
import { LoadMore } from "@langwatch/design-system/load-more";
import { EmptyNextSteps } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Box,
  Button,
  chakra,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ProductScope } from "@langwatch/design-system/product-scope";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { ResourceRow } from "@langwatch/design-system/resource-row";
import { SettingsField, SettingsFieldGroup } from "@langwatch/design-system/settings-field";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { useProductAccent } from "@langwatch/design-system/use-product-accent";
import { Temporal } from "@langwatch/time";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";

const STEPS = [
  { id: "watch", label: "Watch" },
  { id: "delivery", label: "Delivery" },
  { id: "review", label: "Review" },
] as const;

/** The three stages, in the order a new automation walks them. */
export type StepId = (typeof STEPS)[number]["id"];

export type SubjectId = "cost" | "latency";

/** What the automation watches and the one number that makes it fire. */
export interface Draft {
  name: string;
  subject: SubjectId;
  /** Typed text, so the field keeps exactly what the reader wrote. */
  threshold: string;
  /** A destination id, or empty while none is chosen. */
  destination: string;
}

export interface Destination {
  id: string;
  kind: string;
  label: string;
}

export interface Automation extends Draft {
  id: number;
}

/** Your API's save. `id` is set when a saved automation changes. It rejects with a reason. */
export type SaveAutomation = (args: { id?: number; draft: Draft }) => Promise<void>;

/** Your API's test send: it delivers one message to the chosen destination. */
export type SendTest = (draft: Draft) => Promise<void>;

interface Problems {
  name?: string;
  threshold?: string;
  destination?: string;
}

type TestState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "failed"; reason: string };

interface Wizard {
  mode: "create" | "edit";
  automationId?: number;
  draft: Draft;
  step: StepId;
  /** The furthest stage the reader has reached; later ones cannot be opened. */
  furthest: StepId;
  problems: Problems;
  pending: boolean;
  failure?: string;
  test: TestState;
}

/**
 * Only the stories use this: it opens the example already in one of its states.
 * Leave it out in your application.
 */
export interface GuidedSetupStart {
  /** Opens the drawer to create (default) or to change the first saved automation. */
  mode?: "create" | "edit";
  /** Opens the drawer on this stage. Edit opens on Review. */
  step?: StepId;
  furthest?: StepId;
  draft?: Partial<Draft>;
  problems?: Problems;
  /** A save in flight. */
  saving?: boolean;
  /** A refused save, with the reason. */
  failure?: string;
}

interface Subject {
  id: SubjectId;
  label: string;
  /** Completes "Fires when one trace's ... is above the threshold". */
  measure: string;
  unit: string;
  describe: (threshold: string) => string;
}

const COST: Subject = {
  id: "cost",
  label: "Trace cost",
  measure: "cost",
  unit: "US dollars",
  describe: (threshold) => `$${threshold}`,
};
const LATENCY: Subject = {
  id: "latency",
  label: "Trace latency",
  measure: "latency",
  unit: "seconds",
  describe: (threshold) => `${threshold} seconds`,
};
const SUBJECTS: Subject[] = [COST, LATENCY];

export const DESTINATIONS: Destination[] = [
  { id: "slack-support", kind: "Slack", label: "#support-alerts" },
  { id: "email-on-call", kind: "Email", label: "Support on-call" },
  { id: "webhook-escalation", kind: "Webhook", label: "Escalation webhook" },
];

export const SEED_AUTOMATIONS: Automation[] = [
  {
    id: 1,
    name: "Slow responses",
    subject: "latency",
    threshold: "8",
    destination: "email-on-call",
  },
];

const NEW_DRAFT: Draft = {
  name: "High-cost traces",
  subject: "cost",
  threshold: "",
  destination: "",
};

const DELIVERY_SETTINGS = "/settings/automations/destinations";
const DOCS = "https://docs.langwatch.ai/features/triggers";
const NO_DESTINATION_PROMPT =
  "Add a Slack channel called #support-alerts as a delivery destination for LangWatch automations in the Support assistant project.";

/** Stand-ins for your API: both succeed straight away. Pass your own to call a real one. */
const saveLocally: SaveAutomation = () => Promise.resolve();
const sendLocally: SendTest = () => Promise.resolve();

function subjectOf(id: SubjectId): Subject {
  return id === "latency" ? LATENCY : COST;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "The service did not answer.";
}

function stepIndex(step: StepId): number {
  return STEPS.findIndex((item) => item.id === step);
}

function thresholdIsValid(threshold: string): boolean {
  const amount = Number(threshold);
  return threshold.trim() !== "" && Number.isFinite(amount) && amount > 0;
}

function destinationOf({
  draft,
  destinations,
}: {
  draft: Draft;
  destinations: Destination[];
}): Destination | undefined {
  return destinations.find((destination) => destination.id === draft.destination);
}

function describeDestination(destination: Destination): string {
  return `${destination.label} (${destination.kind})`;
}

function stepIsComplete({
  step,
  draft,
  destinations,
}: {
  step: StepId;
  draft: Draft;
  destinations: Destination[];
}): boolean {
  if (step === "watch") return thresholdIsValid(draft.threshold);
  if (step === "delivery") return destinationOf({ draft, destinations }) !== undefined;
  return (
    draft.name.trim() !== "" &&
    stepIsComplete({ step: "watch", draft, destinations }) &&
    stepIsComplete({ step: "delivery", draft, destinations })
  );
}

function stepSummary({
  step,
  draft,
  destinations,
}: {
  step: StepId;
  draft: Draft;
  destinations: Destination[];
}): string {
  if (step === "watch") {
    if (!stepIsComplete({ step, draft, destinations })) return "";
    const subject = subjectOf(draft.subject);
    return `${subject.label} above ${subject.describe(draft.threshold.trim())}`;
  }
  if (step === "delivery") {
    const destination = destinationOf({ draft, destinations });
    return destination ? describeDestination(destination) : "";
  }
  return stepIsComplete({ step, draft, destinations }) ? draft.name.trim() : "";
}

/** A stage opens when it is the current one, or it is reached and every stage before it is done. */
function stepIsReachable({
  target,
  wizard,
  destinations,
}: {
  target: StepId;
  wizard: Wizard;
  destinations: Destination[];
}): boolean {
  if (target === wizard.step) return true;
  if (stepIndex(target) > stepIndex(wizard.furthest)) return false;
  return STEPS.slice(0, stepIndex(target)).every((earlier) =>
    stepIsComplete({ step: earlier.id, draft: wizard.draft, destinations }),
  );
}

function problemsFor({
  step,
  draft,
  destinations,
}: {
  step: StepId;
  draft: Draft;
  destinations: Destination[];
}): Problems {
  if (step === "watch" && !thresholdIsValid(draft.threshold)) {
    return { threshold: "Enter a threshold above 0 to continue." };
  }
  if (step === "delivery" && !destinationOf({ draft, destinations })) {
    return { destination: "Choose where this automation sends its alerts." };
  }
  if (step === "review" && draft.name.trim() === "") return { name: "Name is required" };
  return {};
}

function wizardFrom({ start }: { start: GuidedSetupStart }): Wizard | undefined {
  const mode = start.mode ?? "create";
  if (start.step === undefined && mode === "create") return undefined;
  const saved = SEED_AUTOMATIONS[0];
  const base: Draft = mode === "edit" && saved ? { ...saved } : NEW_DRAFT;
  const step = start.step ?? "review";
  return {
    mode,
    automationId: mode === "edit" ? saved?.id : undefined,
    draft: { ...base, ...start.draft },
    step,
    furthest: mode === "edit" ? "review" : (start.furthest ?? step),
    problems: start.problems ?? {},
    pending: start.saving === true,
    failure: start.failure,
    test: { status: "idle" },
  };
}

function freshWizard({ automation }: { automation?: Automation }): Wizard {
  return {
    mode: automation ? "edit" : "create",
    automationId: automation?.id,
    draft: automation ? { ...automation } : NEW_DRAFT,
    step: automation ? "review" : "watch",
    furthest: automation ? "review" : "watch",
    problems: {},
    pending: false,
    test: { status: "idle" },
  };
}

/**
 * Automations with a three-stage setup in a Drawer: Watch, Delivery, Review. Going back keeps
 * every answer; a stage opens only once the ones before it are done. Test delivery and the final
 * save run through the two callbacks, so your application owns the transport.
 */
export function GuidedSetup({
  start = {},
  destinations = DESTINATIONS,
  saveAutomation = saveLocally,
  sendTest = sendLocally,
}: {
  start?: GuidedSetupStart;
  destinations?: Destination[];
  saveAutomation?: SaveAutomation;
  sendTest?: SendTest;
}) {
  const [automations, setAutomations] = useState<Automation[]>(SEED_AUTOMATIONS);
  const [wizard, setWizard] = useState<Wizard | undefined>(() => wizardFrom({ start }));
  const [open, setOpen] = useState(wizard !== undefined);
  const nextId = useRef(Math.max(0, ...SEED_AUTOMATIONS.map((item) => item.id)) + 1);
  const newButton = useRef<HTMLButtonElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const fields = useRef<StepFields>({ panel: null, name: null, threshold: null });
  useFocusOnStepChange({ step: wizard?.step, fields });

  const patch = (change: Partial<Wizard>) =>
    setWizard((current) => (current ? { ...current, ...change } : current));
  const patchDraft = (change: Partial<Draft>) =>
    setWizard((current) => (current ? withDraftChange({ wizard: current, change }) : current));

  const save = async () => {
    if (!wizard) return;
    patch({ pending: true, failure: undefined });
    try {
      await saveAutomation({ id: wizard.automationId, draft: wizard.draft });
    } catch (error) {
      patch({ pending: false, failure: reasonOf(error) });
      return;
    }
    const saved: Automation = { ...wizard.draft, id: wizard.automationId ?? nextId.current++ };
    setAutomations((current) => withSaved({ automations: current, saved }));
    patch({ pending: false });
    setOpen(false);
    announceSaved({ saved, mode: wizard.mode });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!wizard || wizard.pending) return;
    const problems = problemsFor({ step: wizard.step, draft: wizard.draft, destinations });
    if (Object.keys(problems).length > 0) {
      patch({ problems });
      focusProblem({ problems, fields: fields.current });
    } else if (wizard.step === "review") void save();
    else patch(movedTo({ wizard, step: STEPS[stepIndex(wizard.step) + 1]?.id ?? "review" }));
  };

  const sendTestMessage = async () => {
    if (!wizard) return;
    patch({ test: { status: "sending" } });
    try {
      await sendTest(wizard.draft);
      patch({ test: { status: "sent" } });
    } catch (error) {
      patch({ test: { status: "failed", reason: reasonOf(error) } });
    }
  };

  const openWith = (automation?: Automation) => {
    setWizard(freshWizard({ automation }));
    setOpen(true);
  };

  const restoreFocus = () => {
    const id = wizard?.automationId;
    const edit = page.current?.querySelector<HTMLElement>(`[data-automation-id="${id}"]`);
    (id === undefined ? newButton.current : edit)?.focus();
  };

  return (
    <ProductScope product="llm-ops">
      <PageLayout.Header
        description="Act on traces the moment they cross a limit you choose."
        actions={
          <PageLayout.HeaderButton primary ref={newButton} onClick={() => openWith()}>
            New automation
          </PageLayout.HeaderButton>
        }
      >
        <PageLayout.Heading>Automations</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container width="fill">
        <AutomationList
          automations={automations}
          destinations={destinations}
          listRef={page}
          onEdit={openWith}
        />
      </PageLayout.Container>
      {wizard && (
        <SetupDrawer
          wizard={wizard}
          destinations={destinations}
          open={open}
          fields={fields}
          onClose={() => setOpen(false)}
          onExitComplete={restoreFocus}
          onSubmit={submit}
          onChange={patchDraft}
          onGo={(step) => patch(movedTo({ wizard, step }))}
          onTest={() => void sendTestMessage()}
        />
      )}
      <Toaster />
    </ProductScope>
  );
}

/** The elements a step needs to reach: the panel, and the two fields Continue can refuse. */
interface StepFields {
  panel: HTMLDivElement | null;
  name: HTMLInputElement | null;
  threshold: HTMLInputElement | null;
}

/** After a stage change, focus moves to the first control of the new stage. */
function useFocusOnStepChange({
  step,
  fields,
}: {
  step: StepId | undefined;
  fields: RefObject<StepFields>;
}) {
  const shown = useRef(step);
  useEffect(() => {
    if (step === shown.current) return;
    shown.current = step;
    fields.current.panel?.querySelector<HTMLElement>("input, select, button")?.focus();
  }, [step, fields]);
}

function focusProblem({ problems, fields }: { problems: Problems; fields: StepFields }) {
  if (problems.name) fields.name?.focus();
  else if (problems.threshold) fields.threshold?.focus();
  else fields.panel?.querySelector<HTMLElement>("input")?.focus();
}

function movedTo({ wizard, step }: { wizard: Wizard; step: StepId }): Partial<Wizard> {
  const further = stepIndex(step) > stepIndex(wizard.furthest);
  return { step, furthest: further ? step : wizard.furthest, problems: {} };
}

/** A changed answer clears an earlier test result: it no longer describes the draft. */
function withDraftChange({ wizard, change }: { wizard: Wizard; change: Partial<Draft> }): Wizard {
  return { ...wizard, draft: { ...wizard.draft, ...change }, test: { status: "idle" } };
}

function withSaved({
  automations,
  saved,
}: {
  automations: Automation[];
  saved: Automation;
}): Automation[] {
  const exists = automations.some((item) => item.id === saved.id);
  if (!exists) return [...automations, saved];
  return automations.map((item) => (item.id === saved.id ? saved : item));
}

function announceSaved({ saved, mode }: { saved: Automation; mode: Wizard["mode"] }) {
  toaster.create({
    id: `automation-${saved.id}-saved`,
    type: "success",
    title: mode === "create" ? "Automation created" : "Automation updated",
    description: saved.name,
  });
}

function AutomationList({
  automations,
  destinations,
  listRef,
  onEdit,
}: {
  automations: Automation[];
  destinations: Destination[];
  listRef: RefObject<HTMLDivElement | null>;
  onEdit: (automation: Automation) => void;
}) {
  return (
    <Stack as="ul" gap={3} ref={listRef} aria-label="Automations" listStyleType="none" padding={0}>
      {automations.map((automation) => (
        <Box as="li" key={automation.id}>
          <ResourceRow
            name={automation.name}
            description={`${subjectOf(automation.subject).label} above ${subjectOf(automation.subject).describe(automation.threshold)}`}
            meta={describeDestinationOf({ automation, destinations })}
            status={
              <Button
                size="xs"
                variant="outline"
                aria-label={`Edit ${automation.name}`}
                data-automation-id={automation.id}
                onClick={() => onEdit(automation)}
              >
                Edit
              </Button>
            }
          />
        </Box>
      ))}
    </Stack>
  );
}

function footerFor({
  wizard,
  destinations,
  onClose,
  onBack,
  onTest,
}: {
  wizard: Wizard;
  destinations: Destination[];
  onClose: () => void;
  onBack: () => void;
  onTest: () => void;
}): DrawerFooterProps {
  const noWhereToSend = wizard.step === "delivery" && destinations.length === 0;
  return {
    cancel: { onClick: onClose },
    note: `Step ${stepIndex(wizard.step) + 1} of ${STEPS.length}`,
    secondaryAction: wizard.step === "watch" ? undefined : { label: "Back", onClick: onBack },
    utilityActions:
      wizard.step === "review"
        ? [
            {
              label: "Send test message",
              onClick: onTest,
              loading: wizard.test.status === "sending",
            },
          ]
        : undefined,
    primaryAction: {
      label: primaryLabel(wizard),
      type: "submit",
      loading: wizard.pending,
      disabledReason: noWhereToSend ? "Add a delivery destination to continue." : undefined,
    },
  };
}

function SetupDrawer({
  wizard,
  destinations,
  open,
  fields,
  onClose,
  onExitComplete,
  onSubmit,
  onChange,
  onGo,
  onTest,
}: {
  wizard: Wizard;
  destinations: Destination[];
  open: boolean;
  fields: RefObject<StepFields>;
  onClose: () => void;
  onExitComplete: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (change: Partial<Draft>) => void;
  onGo: (step: StepId) => void;
  onTest: () => void;
}) {
  const creating = wizard.mode === "create";
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={creating ? "New automation" : "Edit automation"}
      subtitle={
        creating
          ? "Alert someone when a single trace crosses a limit."
          : "Changes apply to traces that arrive after you save."
      }
      size="lg"
      busy={wizard.pending}
      onSubmit={onSubmit}
      initialFocusEl={() => (wizard.step === "watch" ? fields.current.name : null)}
      onExitComplete={onExitComplete}
      footer={footerFor({
        wizard,
        destinations,
        onClose,
        onBack: () => onGo(STEPS[stepIndex(wizard.step) - 1]?.id ?? "watch"),
        onTest,
      })}
    >
      <Stack gap={4}>
        {wizard.failure && (
          <Banner
            status="error"
            placement="inline"
            title="Couldn't save the automation"
            action={
              <EmptyNextSteps
                next={[{ kind: "docs", label: "Automation troubleshooting", href: DOCS }]}
              />
            }
          >
            {wizard.failure} Your answers are still here: save again to retry.
          </Banner>
        )}
        <SettingsField label="Name" error={wizard.problems.name} disabled={wizard.pending}>
          <Input
            ref={(element) => {
              fields.current.name = element;
            }}
            value={wizard.draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </SettingsField>
        <StepRail
          steps={STEPS.map((step) => ({
            id: step.id,
            label: step.label,
            summary: stepSummary({ step: step.id, draft: wizard.draft, destinations }),
            complete: stepIsComplete({ step: step.id, draft: wizard.draft, destinations }),
            reachable: stepIsReachable({ target: step.id, wizard, destinations }),
          }))}
          current={wizard.step}
          onSelect={onGo}
        />
        <div
          ref={(element) => {
            fields.current.panel = element;
          }}
        >
          {wizard.step === "watch" && (
            <WatchStep wizard={wizard} fields={fields} onChange={onChange} />
          )}
          {wizard.step === "delivery" && (
            <DeliveryStep wizard={wizard} destinations={destinations} onChange={onChange} />
          )}
          {wizard.step === "review" && (
            <ReviewStep wizard={wizard} destinations={destinations} onEdit={onGo} />
          )}
        </div>
      </Stack>
    </Drawer>
  );
}

function describeDestinationOf({
  automation,
  destinations,
}: {
  automation: Automation;
  destinations: Destination[];
}): string {
  const destination = destinationOf({ draft: automation, destinations });
  return destination ? `Delivers to ${describeDestination(destination)}` : "No destination";
}

function primaryLabel(wizard: Wizard): string {
  if (wizard.step !== "review") return "Continue";
  return wizard.mode === "create" ? "Create automation" : "Save changes";
}

interface RailStep {
  id: StepId;
  label: string;
  /** The line the stage decided; empty while it has nothing to say. */
  summary: string;
  complete: boolean;
  reachable: boolean;
}

/**
 * The design system has no step rail yet, so this one is built here from its pieces: numbered
 * cards at least 52px tall, a summary line, aria-current="step" and a disabled look for stages
 * that cannot be opened. Replace it with the shared one when it lands.
 */
function StepRail({
  steps,
  current,
  onSelect,
}: {
  steps: RailStep[];
  current: StepId;
  onSelect: (step: StepId) => void;
}) {
  const accent = useProductAccent();
  return (
    <HStack as="nav" aria-label="Automation steps" gap={2} align="stretch" width="full">
      {steps.map((step, index) => {
        const isCurrent = step.id === current;
        return (
          <chakra.button
            key={step.id}
            type="button"
            flex="1"
            minWidth="0"
            textAlign="start"
            paddingX={2.5}
            paddingY={2}
            borderRadius="md"
            borderWidth="1px"
            minHeight="52px"
            display="flex"
            alignItems="center"
            colorPalette={accent.colorPalette}
            borderColor={isCurrent ? "colorPalette.emphasized" : "border"}
            bg={isCurrent ? "colorPalette.subtle" : "bg"}
            opacity={step.reachable ? 1 : 0.55}
            cursor={step.reachable ? "pointer" : "not-allowed"}
            _focusVisible={{
              outline: "2px solid",
              outlineColor: "colorPalette.focusRing",
              outlineOffset: "1px",
            }}
            aria-current={isCurrent ? "step" : undefined}
            aria-disabled={step.reachable ? undefined : true}
            onClick={step.reachable ? () => onSelect(step.id) : undefined}
          >
            <VStack align="start" gap={0} minWidth={0} width="full">
              <HStack gap={1.5}>
                <Text textStyle="2xs" color="fg.muted" fontWeight="semibold" aria-hidden="true">
                  {index + 1}
                </Text>
                <Text textStyle="sm" fontWeight="semibold">
                  {step.label}
                </Text>
                {step.complete && !isCurrent && (
                  <Text as="span" color="green.fg">
                    <span aria-hidden="true">✓</span>
                    <Box as="span" srOnly>
                      complete
                    </Box>
                  </Text>
                )}
              </HStack>
              {step.summary && !isCurrent && (
                <Text textStyle="2xs" color="fg.muted" lineClamp={1} width="full">
                  {step.summary}
                </Text>
              )}
            </VStack>
          </chakra.button>
        );
      })}
    </HStack>
  );
}

function WatchStep({
  wizard,
  fields,
  onChange,
}: {
  wizard: Wizard;
  fields: RefObject<StepFields>;
  onChange: (change: Partial<Draft>) => void;
}) {
  const subject = subjectOf(wizard.draft.subject);
  const locked = wizard.mode === "edit";
  return (
    <SettingsFieldGroup>
      <SettingsField
        label="What to watch"
        hint={
          locked
            ? "What an automation watches cannot be changed once it is saved. Create a new one to watch something else."
            : "The measure on each trace that the threshold applies to."
        }
        disabled={wizard.pending || locked}
      >
        <NativeSelect.Root width="full">
          <NativeSelect.Field
            value={wizard.draft.subject}
            onChange={(event) => {
              const chosen = SUBJECTS.find((item) => item.id === event.target.value);
              if (chosen) onChange({ subject: chosen.id });
            }}
          >
            {SUBJECTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </SettingsField>
      <SettingsField
        label="Threshold"
        hint={`Fires when one trace's ${subject.measure} is above this, in ${subject.unit}.`}
        error={wizard.problems.threshold}
        disabled={wizard.pending}
      >
        <Input
          ref={(element) => {
            fields.current.threshold = element;
          }}
          inputMode="decimal"
          value={wizard.draft.threshold}
          onChange={(event) => onChange({ threshold: event.target.value })}
        />
      </SettingsField>
    </SettingsFieldGroup>
  );
}

function DeliveryStep({
  wizard,
  destinations,
  onChange,
}: {
  wizard: Wizard;
  destinations: Destination[];
  onChange: (change: Partial<Draft>) => void;
}) {
  const accent = useProductAccent();
  if (destinations.length === 0) {
    return (
      <Banner
        status="warning"
        placement="inline"
        title="No delivery destinations yet"
        action={
          <EmptyNextSteps
            next={[
              {
                kind: "setting",
                label: "Open delivery settings",
                href: DELIVERY_SETTINGS,
                onNavigate: () => undefined,
              },
              { kind: "agent-prompt", prompt: NO_DESTINATION_PROMPT },
            ]}
          />
        }
      >
        An automation needs somewhere to send its alerts, and Continue stays off until you connect
        one: Slack, an email address or a webhook.
      </Banner>
    );
  }
  return (
    <SettingsField
      label="Send to"
      hint="Where each alert is delivered."
      error={wizard.problems.destination}
      disabled={wizard.pending}
    >
      <RadioGroup
        aria-label="Send to"
        colorPalette={accent.colorPalette}
        value={wizard.draft.destination}
        disabled={wizard.pending}
        onValueChange={(details) => onChange({ destination: details.value ?? "" })}
      >
        <Stack gap={2}>
          {destinations.map((destination) => (
            <Radio key={destination.id} value={destination.id}>
              {describeDestination(destination)}
            </Radio>
          ))}
        </Stack>
      </RadioGroup>
    </SettingsField>
  );
}

function ReviewStep({
  wizard,
  destinations,
  onEdit,
}: {
  wizard: Wizard;
  destinations: Destination[];
  onEdit: (step: StepId) => void;
}) {
  const subject = subjectOf(wizard.draft.subject);
  const destination = destinationOf({ draft: wizard.draft, destinations });
  return (
    <Stack gap={3}>
      <TestNotice wizard={wizard} destination={destination} />
      <Card
        variant="nested"
        title="Watches"
        titleLevel={3}
        padding="sm"
        actions={
          <Button
            size="xs"
            variant="ghost"
            aria-label="Edit what this automation watches"
            disabled={wizard.pending}
            onClick={() => onEdit("watch")}
          >
            Edit
          </Button>
        }
      >
        <Text textStyle="sm">
          Fires when one trace&apos;s {subject.measure} is above{" "}
          {subject.describe(wizard.draft.threshold.trim())}.
        </Text>
      </Card>
      <Card
        variant="nested"
        title="Delivery"
        titleLevel={3}
        padding="sm"
        actions={
          <Button
            size="xs"
            variant="ghost"
            aria-label="Edit delivery"
            disabled={wizard.pending}
            onClick={() => onEdit("delivery")}
          >
            Edit
          </Button>
        }
      >
        <Text textStyle="sm">
          {destination ? `Delivers to ${describeDestination(destination)}.` : "No destination yet."}
        </Text>
      </Card>
    </Stack>
  );
}

function TestNotice({
  wizard,
  destination,
}: {
  wizard: Wizard;
  destination: Destination | undefined;
}) {
  const where = destination ? describeDestination(destination) : "the destination";
  if (wizard.test.status === "sent") {
    return (
      <Banner status="success" placement="inline" title="Test message sent">
        One message went to {where}. Check it arrived, then create the automation.
      </Banner>
    );
  }
  if (wizard.test.status === "failed") {
    return (
      <Banner
        status="error"
        placement="inline"
        title="The test message did not arrive"
        action={
          <EmptyNextSteps
            next={[{ kind: "docs", label: "Delivery troubleshooting", href: DOCS }]}
          />
        }
      >
        {wizard.test.reason} You can fix the destination and send another test, or save anyway.
      </Banner>
    );
  }
  return null;
}

/** One earlier firing, fixed so the history reads the same every time. */
export interface Fire {
  id: string;
  firedAt: number;
  seconds: number;
  traceId: string;
}

const FIRE_ROWS: [string, number, string][] = [
  ["2026-10-02T15:40:00Z", 11.2, "tr_9c41"],
  ["2026-10-02T09:05:00Z", 9.4, "tr_7f3a"],
  ["2026-10-01T17:22:00Z", 8.6, "tr_6b20"],
  ["2026-10-01T10:48:00Z", 12.9, "tr_51de"],
  ["2026-09-30T14:15:00Z", 9.9, "tr_4a07"],
  ["2026-09-30T08:31:00Z", 10.3, "tr_3e92"],
  ["2026-09-29T16:02:00Z", 8.2, "tr_28cc"],
  ["2026-09-29T11:37:00Z", 13.5, "tr_1d65"],
  ["2026-09-28T19:54:00Z", 9.1, "tr_0b8f"],
  ["2026-09-26T13:09:00Z", 10.8, "tr_f7a4"],
  ["2026-09-25T09:26:00Z", 8.9, "tr_e630"],
  ["2026-09-23T15:11:00Z", 11.7, "tr_d2b1"],
  ["2026-09-21T12:44:00Z", 9.6, "tr_c548"],
  ["2026-09-18T10:03:00Z", 8.4, "tr_b19d"],
];

export const FIRES: Fire[] = FIRE_ROWS.map(([firedAt, seconds, traceId], index) => ({
  id: `fire-${index + 1}`,
  firedAt: Temporal.Instant.from(firedAt).epochMilliseconds,
  seconds,
  traceId,
}));

const PAGE_SIZE = 5;

/** Your API's page of earlier firings, newest first, after the `loaded` ones already shown. */
export type LoadEarlier = (args: { loaded: number }) => Promise<{ fires: Fire[]; total: number }>;

const loadFromFixture: LoadEarlier = ({ loaded }) =>
  Promise.resolve({ fires: FIRES.slice(loaded, loaded + PAGE_SIZE), total: FIRES.length });

/** Only the stories use this. */
export interface HistoryStart {
  /** How many firings are already on screen. */
  loaded?: number;
  /** An earlier page is loading. */
  loadingMore?: boolean;
}

/**
 * The firing history of one automation in a Drawer: newest first, with Load more adding the
 * next older page under the rows already shown. Nothing is replaced and nothing is repeated.
 */
export function AutomationHistory({
  start = {},
  loadEarlier = loadFromFixture,
}: {
  start?: HistoryStart;
  loadEarlier?: LoadEarlier;
}) {
  const [open, setOpen] = useState(true);
  const [fires, setFires] = useState<Fire[]>(() => FIRES.slice(0, start.loaded ?? PAGE_SIZE));
  const [total, setTotal] = useState(FIRES.length);
  const [loadingMore, setLoadingMore] = useState(start.loadingMore === true);
  const [failure, setFailure] = useState<string>();

  const loadMore = async () => {
    setLoadingMore(true);
    setFailure(undefined);
    try {
      const page = await loadEarlier({ loaded: fires.length });
      setFires((current) => {
        const known = new Set(current.map((fire) => fire.id));
        return [...current, ...page.fires.filter((fire) => !known.has(fire.id))];
      });
      setTotal(page.total);
    } catch (error) {
      setFailure(reasonOf(error));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <ProductScope product="llm-ops">
      <PageLayout.Header
        description="Fires when one trace's latency is above 8 seconds."
        actions={
          <PageLayout.HeaderButton primary onClick={() => setOpen(true)}>
            View history
          </PageLayout.HeaderButton>
        }
      >
        <PageLayout.Heading>Slow responses</PageLayout.Heading>
      </PageLayout.Header>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Slow responses"
        subtitle="Every time this automation fired, newest first."
        size="md"
      >
        <Stack gap={3}>
          <ActivityTimeline
            title="History"
            timeZone="UTC"
            locale="en-GB"
            entries={fires.map((fire) => ({
              id: fire.id,
              occurredAtMs: fire.firedAt,
              content: `Fired for a trace that took ${fire.seconds} seconds`,
              meta: `Trace ${fire.traceId}`,
            }))}
            emptyState={
              <Stack gap={2}>
                <Text>This automation has not fired yet. It checks every trace as it arrives.</Text>
                <HStack>
                  <EmptyNextSteps
                    next={[{ kind: "docs", label: "How automations fire", href: DOCS }]}
                  />
                </HStack>
              </Stack>
            }
          />
          {failure && (
            <Banner
              status="error"
              placement="inline"
              title="Couldn't load earlier firings"
              action={<BannerAction onClick={() => void loadMore()}>Try again</BannerAction>}
            >
              {failure} The firings above are still here.
            </Banner>
          )}
          <LoadMore
            hasMore={fires.length < total}
            loading={loadingMore}
            onLoadMore={() => void loadMore()}
            shown={fires.length}
            total={total}
            unitLabel="firings"
          />
        </Stack>
      </Drawer>
    </ProductScope>
  );
}
