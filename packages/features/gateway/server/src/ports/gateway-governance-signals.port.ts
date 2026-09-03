/**
 * The Enterprise governance ledger's view of a virtual key's life.
 *
 * A port rather than a direct call: governance is an Enterprise capability and
 * a core package may not reach one. The payload is restated structurally for
 * the same reason — the Enterprise signal type is the authority, and this is
 * the subset the gateway can produce.
 *
 * Absent on every deployment that composes no governance ledger, which is what
 * the application being retired did in every process: it constructed the
 * Enterprise service in its DISABLED form, so each of the five lifecycle
 * emissions below reached a null object. Leaving the port unset preserves that
 * behaviour and, unlike the disabled object, says so.
 */
export type GatewayVirtualKeyLifecycleSignal = {
  virtualKey: {
    id: string;
    organizationId: string;
    name: string;
    displayPrefix: string;
    traceProjectId: string | null;
  };
  action: "created" | "updated" | "rotated" | "revoked" | "disabled" | "enabled";
  reason?: string | null;
};

export abstract class GatewayGovernanceSignalsPort {
  abstract emitVirtualKeyLifecycle(signal: GatewayVirtualKeyLifecycleSignal): Promise<void>;
}
