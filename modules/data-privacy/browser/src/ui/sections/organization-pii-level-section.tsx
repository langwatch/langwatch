/**
 * The organization's Essential or Strict picker over its own rule, saved with the drawer's
 * setForScope. Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type { DataPrivacySnapshot, PiiLevel } from "@langwatch/data-privacy-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { useEffect, useEffectEvent, useState } from "react";

import { dataPrivacyApi } from "../../behavior/data-privacy-api.ts";
import { type InFlight, useInFlight } from "../../behavior/use-in-flight.ts";
import type { AcceptPiiRedactionModel } from "../../behavior/use-pii-redaction-model-acceptance.ts";
import type { DataPrivacyHostApi } from "../../model/data-privacy-host.ts";
import {
  awaitsAcceptance,
  levelChangeStep,
  type ModelAcceptance,
  organizationPiiLevel,
  organizationRule,
  type OrganizationPiiLevel,
  otherPiiLevelLabel,
  type PiiLevelStep,
  type PiiRedactionModel,
  piiLevelStepDialog,
  showsStrictRule,
  switchToModelStep,
  withOrganizationPiiLevel,
} from "../../model/pii-redaction-level-offer.ts";
import { OrganizationPiiLevelPicker } from "../blocks/organization-pii-level-picker.tsx";

/** A pick shown before its save lands, for the organization it was made for. */
type Pick = {
  organizationId: string;
  level: OrganizationPiiLevel;
  over: OrganizationPiiLevel | null;
};

/** What the price prompt is open for, and for which organization: a level picked, or the switch. */
type Asking = { organizationId: string } & (
  | { kind: "level"; level: OrganizationPiiLevel }
  | { kind: "switch" }
);

/**
 * Confirming the price: a switch only records the acceptance; a Strict pick that still needs one
 * records it first and saves only once it is kept.
 */
async function confirmChoice({
  choice,
  acceptance,
  accept,
  save,
  host,
}: {
  choice: Asking;
  acceptance: ModelAcceptance;
  accept: () => Promise<boolean>;
  save: (level: OrganizationPiiLevel) => Promise<void>;
  host: DataPrivacyHostApi;
}): Promise<void> {
  if (choice.kind === "switch") {
    if (await accept()) host.succeeded({ title: "Strict now runs the PII Redaction Model" });
    return;
  }
  if (choice.level === "strict" && acceptance === "can-accept" && !(await accept())) return;
  await save(choice.level);
}

/**
 * A pick shown at once, until the stored level moves (a save landed, or a rule changed it). Only
 * the organization it was made for shows it, so a save finishing after the page moved on never
 * shows on the next one.
 */
function useOptimisticPick({
  organizationId,
  stored,
}: {
  organizationId: string | undefined;
  stored: string | undefined;
}) {
  const [picked, setPicked] = useState<Pick | null>(null);
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setPicked(null);
  }
  return {
    picked: picked?.organizationId === organizationId ? picked : null,
    show: (pick: Pick) => setPicked(pick),
    /** Drops a failed save's pick, unless a pick for another organization replaced it. */
    drop: (forOrganization: string) =>
      setPicked((current) => (current?.organizationId === forOrganization ? null : current)),
  };
}

/** What the prompt does next for a choice: a level change's step, or the switch's. */
function stepOfChoice({
  choice,
  from,
  model,
  acceptance,
}: {
  choice: Asking;
  from: PiiLevel;
  model: PiiRedactionModel;
  acceptance: ModelAcceptance;
}): PiiLevelStep {
  if (choice.kind === "switch") return switchToModelStep(model);
  return levelChangeStep({ from, to: choice.level, model, acceptance });
}

/** Reads the plan again for a model priced before its currency is known; otherwise nothing. */
function priceReaderOf(model: PiiRedactionModel): () => Promise<void> {
  return !model.free && model.currency === "unknown" ? model.readPrice : async () => {};
}

/** A waiting choice left with nothing to ask (the model turned free) applies as a direct one. */
function useApplyWaitingChoice({
  asking,
  from,
  model,
  acceptance,
  ready,
  apply,
}: {
  asking: Asking | null;
  from: PiiLevel | undefined;
  model: PiiRedactionModel;
  acceptance: ModelAcceptance;
  ready: boolean;
  apply: (choice: Asking) => void;
}) {
  const kind =
    asking && from !== undefined
      ? stepOfChoice({ choice: asking, from, model, acceptance }).kind
      : null;
  const run = useEffectEvent(() => {
    if (asking && ready) apply(asking);
  });
  useEffect(() => {
    if (kind === "save") run();
  }, [kind]);
}

/** The open prompt, dismissed once the page shows another organization than it was opened for. */
function useAskingFor(organizationId: string | undefined) {
  const [asking, setAsking] = useState<Asking | null>(null);
  if (asking && asking.organizationId !== organizationId) setAsking(null);
  return [asking, setAsking] as const;
}

/**
 * Strict at a price, or replacing Custom, asks first; a free organization is never asked. Until
 * an admin accepts the price, Strict is rule-based: confirming the price, by picking Strict or
 * by switching a rule-based Strict to the model, records the acceptance first.
 */
export function OrganizationPiiLevelSection({
  model,
  acceptance,
  onAccept,
  acceptanceInFlight,
  host,
  projectId,
  snapshot,
  onSaved,
}: {
  /** Strict's model: its price in the subscription's currency, or why it is included. */
  model: PiiRedactionModel;
  acceptance: ModelAcceptance;
  onAccept: AcceptPiiRedactionModel;
  /** The page's acceptance in flight: a pick made meanwhile would be overwritten by its save. */
  acceptanceInFlight: InFlight;
  host: DataPrivacyHostApi;
  projectId: string;
  snapshot: DataPrivacySnapshot;
  onSaved: () => void;
}) {
  const setForScope = dataPrivacyApi.dataPrivacy.setForScope.useMutation();
  const organizationId = snapshot.available.organization?.id ?? host.scope().organizationId;
  const optimistic = useOptimisticPick({
    organizationId,
    stored: snapshot.effectiveOrganization?.pii.level,
  });
  const [asking, setAsking] = useAskingFor(organizationId);
  const readingPrice = useInFlight();
  const ready = !!organizationId && !!snapshot.effectiveOrganization;
  useApplyWaitingChoice({
    asking,
    from: snapshot.effectiveOrganization?.pii.level,
    model,
    acceptance,
    ready,
    apply: (choice) => {
      setAsking(null);
      settle(choice);
    },
  });
  if (!organizationId || !snapshot.effectiveOrganization) return null;

  const storedPii = snapshot.effectiveOrganization.pii;
  const stored = organizationPiiLevel(storedPii.level);
  const picked = optimistic.picked;
  const shown = picked && picked.over === stored ? picked.level : stored;
  const ownRule = organizationRule({ rules: snapshot.rules, organizationId });
  const stepOf = (choice: Asking) =>
    stepOfChoice({ choice, from: storedPii.level, model, acceptance });
  // Read live: a choice waiting for the price asks with it once the plan answers.
  const step = asking ? stepOf(asking) : null;
  const confirmation = piiLevelStepDialog(step);
  const readPrice = () => readingPrice.run(priceReaderOf(model));
  const choose = (choice: Asking) => {
    const next = stepOf(choice).kind;
    if (next === "save") return settle(choice);
    setAsking(choice);
    if (next === "wait") void readPrice();
  };

  const save = async (level: OrganizationPiiLevel) => {
    optimistic.show({ organizationId, level, over: stored });
    try {
      await setForScope.mutateAsync({
        projectId,
        scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
        personalOnly: false,
        config: withOrganizationPiiLevel({ config: ownRule?.config ?? {}, level }),
      });
      onSaved();
      host.succeeded({ title: `Organization on ${level === "strict" ? "Strict" : "Essential"}` });
    } catch (error) {
      optimistic.drop(organizationId);
      host.failed({ error, fallbackTitle: "Couldn't change the organization's PII level" });
    }
  };
  // A choice with nothing to ask: a level saves; the switch has nothing to record.
  const settle = (choice: Asking) => {
    if (choice.kind === "level") void save(choice.level);
  };

  return (
    <>
      <OrganizationPiiLevelPicker
        level={shown}
        pendingLevel={asking?.kind === "level" ? asking.level : null}
        otherLevelLabel={otherPiiLevelLabel({
          level: storedPii.level,
          entityCount: storedPii.entities.length,
        })}
        model={model}
        awaitingAcceptance={awaitsAcceptance(acceptance)}
        strictRuleShown={showsStrictRule({ rules: snapshot.rules })}
        canWrite={snapshot.available.organization !== null}
        isSaving={setForScope.isPending || acceptanceInFlight.inFlight}
        onPick={(level) => choose({ organizationId, kind: "level", level })}
        onSwitchToModel={
          acceptance === "can-accept" ? () => choose({ organizationId, kind: "switch" }) : undefined
        }
      />
      <ConfirmDialog
        open={confirmation !== null}
        onClose={() => setAsking(null)}
        onConfirm={() => {
          if (step?.kind === "wait") return void readPrice();
          const choice = asking;
          setAsking(null);
          if (!choice) return;
          const accept = () => onAccept({ organizationId: choice.organizationId });
          void acceptanceInFlight.run(() =>
            confirmChoice({ choice, acceptance, accept, save, host }),
          );
        }}
        title={confirmation?.title ?? ""}
        description={confirmation?.description ?? ""}
        confirmLabel={confirmation?.confirmLabel}
        loading={step?.kind === "wait" && readingPrice.inFlight}
        tone="default"
      />
    </>
  );
}
