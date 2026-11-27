/**
 * The organization's Essential or Strict picker over its own rule, saved with the drawer's
 * setForScope. Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type { DataPrivacySnapshot } from "@langwatch/data-privacy-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { useEffect, useEffectEvent, useState } from "react";

import { dataPrivacyApi } from "../../behavior/data-privacy-api.ts";
import type { DataPrivacyHostApi } from "../../model/data-privacy-host.ts";
import {
  levelChangeStep,
  organizationPiiLevel,
  organizationRule,
  type OrganizationPiiLevel,
  otherPiiLevelLabel,
  type PiiRedactionModel,
  piiLevelStepDialog,
  withOrganizationPiiLevel,
} from "../../model/pii-redaction-level-offer.ts";
import { OrganizationPiiLevelPicker } from "../blocks/organization-pii-level-picker.tsx";

type Pick = { level: OrganizationPiiLevel; over: OrganizationPiiLevel | null };

/** A pick shown at once, until the stored level moves (a save landed, or a rule changed it). */
function useOptimisticPick(stored: string | undefined) {
  const [picked, setPicked] = useState<Pick | null>(null);
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setPicked(null);
  }
  return [picked, setPicked] as const;
}

/** A waiting pick left with nothing to ask (the model turned free) applies as a direct pick. */
function useApplyWaitingPick({
  asking,
  from,
  model,
  ready,
  apply,
}: {
  asking: OrganizationPiiLevel | null;
  from: Parameters<typeof levelChangeStep>[0]["from"] | undefined;
  model: PiiRedactionModel;
  ready: boolean;
  apply: (level: OrganizationPiiLevel) => void;
}) {
  const kind =
    asking && from !== undefined ? levelChangeStep({ from, to: asking, model }).kind : null;
  const run = useEffectEvent(() => {
    if (asking && ready) apply(asking);
  });
  useEffect(() => {
    if (kind === "save") run();
  }, [kind]);
}

/** Strict at a price, or replacing Custom, asks first; a free organization is never asked. */
export function OrganizationPiiLevelSection({
  model,
  host,
  projectId,
  snapshot,
  onSaved,
}: {
  /** Strict's model: its price in the subscription's currency, or why it is included. */
  model: PiiRedactionModel;
  host: DataPrivacyHostApi;
  projectId: string;
  snapshot: DataPrivacySnapshot;
  onSaved: () => void;
}) {
  const setForScope = dataPrivacyApi.dataPrivacy.setForScope.useMutation();
  const [picked, setPicked] = useOptimisticPick(snapshot.effectiveOrganization?.pii.level);
  const [asking, setAsking] = useState<OrganizationPiiLevel | null>(null);
  const [readingPrice, setReadingPrice] = useState(false);
  const organizationId = snapshot.available.organization?.id ?? host.scope().organizationId;
  const ready = !!organizationId && !!snapshot.effectiveOrganization;
  useApplyWaitingPick({
    asking,
    from: snapshot.effectiveOrganization?.pii.level,
    model,
    ready,
    apply: (level) => {
      setAsking(null);
      void save(level);
    },
  });
  if (!organizationId || !snapshot.effectiveOrganization) return null;

  const storedPii = snapshot.effectiveOrganization.pii;
  const stored = organizationPiiLevel(storedPii.level);
  const shown = picked && picked.over === stored ? picked.level : stored;
  const ownRule = organizationRule({ rules: snapshot.rules, organizationId });
  const stepFor = (level: OrganizationPiiLevel) =>
    levelChangeStep({ from: storedPii.level, to: level, model });
  // Read live: a pick waiting for the price asks with it once the plan answers.
  const step = asking ? stepFor(asking) : null;
  const confirmation = piiLevelStepDialog(step);
  const readPrice = async () => {
    if (model.free || model.currency !== "unknown") return;
    setReadingPrice(true);
    try {
      await model.readPrice();
    } finally {
      setReadingPrice(false);
    }
  };
  const pick = (level: OrganizationPiiLevel) => {
    const next = stepFor(level).kind;
    if (next === "save") return void save(level);
    setAsking(level);
    if (next === "wait") void readPrice();
  };

  const save = async (level: OrganizationPiiLevel) => {
    setPicked({ level, over: stored });
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
      setPicked(null);
      host.failed({ error, fallbackTitle: "Couldn't change the organization's PII level" });
    }
  };

  return (
    <>
      <OrganizationPiiLevelPicker
        level={shown}
        pendingLevel={asking}
        otherLevelLabel={otherPiiLevelLabel({
          level: storedPii.level,
          entityCount: storedPii.entities.length,
        })}
        model={model}
        canWrite={snapshot.available.organization !== null}
        isSaving={setForScope.isPending}
        onPick={pick}
      />
      <ConfirmDialog
        open={confirmation !== null}
        onClose={() => setAsking(null)}
        onConfirm={() => {
          if (step?.kind === "wait") return void readPrice();
          if (asking) void save(asking);
          setAsking(null);
        }}
        title={confirmation?.title ?? ""}
        description={confirmation?.description ?? ""}
        confirmLabel={confirmation?.confirmLabel}
        loading={step?.kind === "wait" && readingPrice}
        tone="default"
      />
    </>
  );
}
