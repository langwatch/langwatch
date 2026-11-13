/**
 * The organization's Essential or Strict picker over its own rule, saved with the drawer's
 * setForScope. Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type { DataPrivacySnapshot } from "@langwatch/data-privacy-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { useState } from "react";

import { dataPrivacyApi } from "../../behavior/data-privacy-api.ts";
import type { DataPrivacyHostApi } from "../../model/data-privacy-host.ts";
import {
  levelChangeConfirmation,
  organizationPiiLevel,
  organizationRule,
  type OrganizationPiiLevel,
  otherPiiLevelLabel,
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

/** Strict at a price, or replacing Custom, asks first; a free organization is never asked. */
export function OrganizationPiiLevelSection({
  free,
  host,
  projectId,
  snapshot,
  onSaved,
}: {
  free: boolean;
  host: DataPrivacyHostApi;
  projectId: string;
  snapshot: DataPrivacySnapshot;
  onSaved: () => void;
}) {
  const setForScope = dataPrivacyApi.dataPrivacy.setForScope.useMutation();
  const [picked, setPicked] = useOptimisticPick(snapshot.effectiveOrganization?.pii.level);
  const [asking, setAsking] = useState<OrganizationPiiLevel | null>(null);
  const organizationId = snapshot.available.organization?.id ?? host.scope().organizationId;
  if (!organizationId || !snapshot.effectiveOrganization) return null;

  const storedPii = snapshot.effectiveOrganization.pii;
  const stored = organizationPiiLevel(storedPii.level);
  const shown = picked && picked.over === stored ? picked.level : stored;
  const ownRule = organizationRule({ rules: snapshot.rules, organizationId });
  const confirmationFor = (level: OrganizationPiiLevel) =>
    levelChangeConfirmation({ from: storedPii.level, to: level, free });
  const confirmation = asking ? confirmationFor(asking) : null;

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
        free={free}
        canWrite={snapshot.available.organization !== null}
        isSaving={setForScope.isPending}
        onPick={(level) => (confirmationFor(level) ? setAsking(level) : void save(level))}
      />
      <ConfirmDialog
        open={confirmation !== null}
        onClose={() => setAsking(null)}
        onConfirm={() => {
          if (asking) void save(asking);
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
