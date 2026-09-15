/**
 * The settlement sweeper's read side: admissions whose confirmation never
 * arrived, found by asking the spend record rather than keeping a durable
 * timer per request. Reading through a port keeps settlement to one process
 * instance for the whole install, free of a ClickHouse client.
 */

/**
 * An admission still waiting for its outcome, with the attribution the fold
 * recorded for it. The settle command carries this forward so a settled
 * webhook envelope names the organization and key the request belonged to
 * rather than arriving anonymous.
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
