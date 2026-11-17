// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Approving or denying a pending stop, with the toast and the refresh each decision ends with.
 * An approval names the targets the approver was shown, so a stop that changed since is refused.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AgentStopView } from "@langwatch/enterprise-governance-contract";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { useRef, useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "./use-kill-switch.ts";

const PLAN_CHANGED = "agent_stop_plan_changed";

/** A copy of `ids` with `id` added or removed. */
function toggled({ ids, id, on }: { ids: ReadonlySet<string>; id: string; on: boolean }) {
  const next = new Set(ids);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

export function useStopDecisions({ organizationId }: { organizationId: string }) {
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const approve = api.governanceKillSwitch.approveStop.useMutation();
  const deny = api.governanceKillSwitch.denyStop.useMutation();
  // The ref refuses a second press before the re-render; the state draws each row's spinner.
  const inFlight = useRef(new Set<string>());
  const [approving, setApproving] = useState<ReadonlySet<string>>(new Set());
  const [changed, setChanged] = useState<ReadonlyMap<string, unknown>>(new Map());

  const track = ({ id, on }: { id: string; on: boolean }) => {
    inFlight.current = toggled({ ids: inFlight.current, id, on });
    setApproving((current) => toggled({ ids: current, id, on }));
  };

  /** Resolves true when the stop was approved. */
  const approveStop = async (stop: AgentStopView): Promise<boolean> => {
    if (inFlight.current.has(stop.id)) return false;
    track({ id: stop.id, on: true });
    setChanged((current) => {
      const next = new Map(current);
      next.delete(stop.id);
      return next;
    });
    try {
      await approve.mutateAsync({
        organizationId,
        stopId: stop.id,
        expectedTargetIds: stop.targets.map((outcome) => outcome.id),
      });
      toaster.create({ title: `Stopping ${stop.agentName}`, type: "success" });
      await refresh.afterStopChange();
      return true;
    } catch (error) {
      if (readHandledError(error)?.code === PLAN_CHANGED) {
        setChanged((current) => new Map(current).set(stop.id, error));
        await refresh.afterStopChange();
        return false;
      }
      showErrorToast({ error, fallbackTitle: "Couldn't approve the stop" });
      return false;
    } finally {
      track({ id: stop.id, on: false });
    }
  };

  /** Resolves true when the stop was denied. */
  const denyStop = async ({ stop, note }: { stop: AgentStopView; note: string }) => {
    const trimmed = note.trim();
    try {
      await deny.mutateAsync({
        organizationId,
        stopId: stop.id,
        ...(trimmed ? { note: trimmed } : {}),
      });
      toaster.create({ title: `Stop of ${stop.agentName} denied`, type: "info" });
      await refresh.afterStopChange();
      return true;
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't deny the stop" });
      return false;
    }
  };

  return {
    approveStop,
    denyStop,
    isApproving: (stopId: string) => approving.has(stopId),
    /** The refusal of a stop whose targets changed after it was shown, until it is approved again. */
    planChangedOf: (stopId: string) => changed.get(stopId) ?? null,
    isDenying: deny.isPending,
  };
}
