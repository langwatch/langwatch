/**
 * The settlement sweeper's read side: admissions whose confirmation never
 * arrived, found by asking the spend record rather than a durable timer.
 * A port keeps settlement to one process for the install, free of ClickHouse.
 */

/**
 * An admission still waiting for its outcome, with the attribution the fold
 * recorded. The settle command carries this forward so a settled webhook
 * envelope names the org and key the request belonged to, not anonymous.
 */
export interface OpenAdmission {
  tenantId: string;
  gatewayRequestId: string;
  organizationId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  traceId: string;
  requestType: string;
  labels: string[];
  metadata: string;
  admittedAtMs: number;
  /** The identity the request ASKED for. A settlement resolved none of its
   *  own, and the settled envelope has always named the requested one. */
  model: string;
  providerKey: string;
}

export interface OpenAdmissionQuery {
  now: number;
  graceMs: number;
  lookbackMs: number;
}

/** Reads the admissions a sweep may settle, from one store or from many. */
export abstract class GatewayOpenAdmissions {
  abstract findOpenAdmissions(params: OpenAdmissionQuery): Promise<OpenAdmission[]>;
}
