/**
 * The organization's Essential or Strict picker over its own rule, saved with the drawer's
 * setForScope. Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type { DataPrivacySnapshot } from "@langwatch/data-privacy-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { useState } from "react";

import { dataPrivacyApi } from "../../behavior/data-privacy-api.ts";
import type { AcceptPiiRedactionModel } from "../../behavior/use-pii-redaction-model-acceptance.ts";
import type { DataPrivacyHostApi } from "../../model/data-privacy-host.ts";
import {
  awaitsAcceptance,
  levelChangeConfirmation,
  type ModelAcceptance,
  organizationPiiLevel,
  organizationRule,
  type OrganizationPiiLevel,
  otherPiiLevelLabel,
  withOrganizationPiiLevel,
} from "../../model/pii-redaction-level-offer.ts";
import { OrganizationPiiLevelPicker } from "../blocks/organization-pii-level-picker.tsx";

type Pick = { level: OrganizationPiiLevel; over: OrganizationPiiLevel | null };

/** What the price prompt is open for: a level picked, or the switch of a rule-based Strict. */
type Asking = { kind: "level"; level: OrganizationPiiLevel } | { kind: "switch" };

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

/**
 * Strict at a price, or replacing Custom, asks first; a free organization is never asked. Until
 * an admin accepts the price, Strict is rule-based: confirming the price, by picking Strict or
 * by switching a rule-based Strict to the model, records the acceptance first.
 */
export function OrganizationPiiLevelSection({
  free,
  licensed = false,
  split = false,
  acceptance,
  onAccept,
  host,
  projectId,
  snapshot,
  onSaved,
}: {
  free: boolean;
  licensed?: boolean;
  /** Long spans go to the model in parts (ADR-207): the small print names the split limit. */
  split?: boolean;
  acceptance: ModelAcceptance;
  onAccept: AcceptPiiRedactionModel;
  host: DataPrivacyHostApi;
  projectId: string;
  snapshot: DataPrivacySnapshot;
  onSaved: () => void;
}) {
  const setForScope = dataPrivacyApi.dataPrivacy.setForScope.useMutation();
  const [picked, setPicked] = useOptimisticPick(snapshot.effectiveOrganization?.pii.level);
  const [asking, setAsking] = useState<Asking | null>(null);
  const organizationId = snapshot.available.organization?.id ?? host.scope().organizationId;
  if (!organizationId || !snapshot.effectiveOrganization) return null;

  const storedPii = snapshot.effectiveOrganization.pii;
  const stored = organizationPiiLevel(storedPii.level);
  const shown = picked && picked.over === stored ? picked.level : stored;
  const ownRule = organizationRule({ rules: snapshot.rules, organizationId });
  const confirmationFor = (level: OrganizationPiiLevel) =>
    levelChangeConfirmation({ from: storedPii.level, to: level, free });
  const confirmation = asking
    ? confirmationFor(asking.kind === "switch" ? "strict" : asking.level)
    : null;

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

  const accept = () => onAccept({ organizationId });

  return (
    <>
      <OrganizationPiiLevelPicker
        level={shown}
        pendingLevel={asking?.kind === "level" ? asking.level : null}
        otherLevelLabel={otherPiiLevelLabel({
          level: storedPii.level,
          entityCount: storedPii.entities.length,
        })}
        free={free}
        licensed={licensed}
        split={split}
        awaitingAcceptance={awaitsAcceptance(acceptance)}
        canWrite={snapshot.available.organization !== null}
        isSaving={setForScope.isPending}
        onPick={(level) =>
          confirmationFor(level) ? setAsking({ kind: "level", level }) : void save(level)
        }
        onSwitchToModel={
          acceptance === "can-accept" ? () => setAsking({ kind: "switch" }) : undefined
        }
      />
      <ConfirmDialog
        open={confirmation !== null}
        onClose={() => setAsking(null)}
        onConfirm={() => {
          if (asking) void confirmChoice({ choice: asking, acceptance, accept, save, host });
          setAsking(null);
        }}
        title={confirmation?.title ?? ""}
        description={confirmation?.description ?? ""}
        confirmLabel={confirmation?.confirmLabel}
        tone="default"
      />
    </>
  );
}
