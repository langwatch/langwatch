/**
 * The settlement sweeper's read side: admissions whose confirmation never
 * arrived, found by asking the spend record rather than by keeping a durable
 * timer per request.
 *
 * The fold already joins admission to outcome — that is what the projection
 * is — so the open admissions are simply the rows still sitting at
 * `admitted`. Reading them through a port is what lets settlement cost one
 * process instance for the whole install instead of one per gateway request,
 * and it is what keeps the settlement process free of a ClickHouse client.
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
export abstract class GatewayOpenAdmissionsPort {
  abstract findOpenAdmissions(params: OpenAdmissionQuery): Promise<OpenAdmission[]>;
}
