import type { FoldProjectionStore } from "@langwatch/eventing";
import { createTenantId, EventUtils } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_EVENT_VERSION_LATEST,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "../../schemas/constants";
import type {
  GatewaySpendAdmittedEvent,
  GatewaySpendConfirmedEvent,
  GatewaySpendFailedEvent,
  GatewaySpendSettledEvent,
} from "../../schemas/events";
import {
  GatewaySpendFoldProjection,
  type GatewaySpendState,
} from "../gatewaySpend.foldProjection";

const TENANT = "proj_test";
const REQUEST = "01K1REQUESTULID";
const T0 = Date.UTC(2026, 6, 27, 14, 3, 7);
/** The prices the ingest seam already stamped on the outcome events. The
 *  fold copies these; it never reaches for a catalog of its own. */
const CONFIRMED_COST_NANO_USD = 4_262_500;
const FAILED_COST_NANO_USD = 1_086_250;

const stubStore = {} as FoldProjectionStore<GatewaySpendState>;
const projection = new GatewaySpendFoldProjection({ store: stubStore });

function makeEvent<E extends { type: string; data: unknown }>(
  type: E["type"],
  data: E["data"],
  occurredAt: number,
): E {
  return EventUtils.createEvent({
    aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
    aggregateId: REQUEST,
    tenantId: createTenantId(TENANT),
    type: type as Parameters<typeof EventUtils.createEvent>[0]["type"],
    version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
    data,
    metadata: {},
    occurredAt,
    idempotencyKey: `${TENANT}:${REQUEST}:${type}:${occurredAt}`,
  }) as unknown as E;
}

/**
 * The attribution an outcome states about itself, as an emitter that does
 * NOT repeat it leaves it. The fold takes its attribution from the
 * admission, so these fixtures exercise the path where the outcome adds
 * nothing — which is what an older gateway build sends.
 */
const UNATTRIBUTED_OUTCOME = {
  organization_id: "",
  virtual_key_id: "",
  end_user_id: "",
  trace_id: "",
  request_type: "",
  labels: [] as string[],
  metadata: "",
  admitted_at: 0,
  principal_user_id: "",
  team_id: "",
};

/**
 * The attribution an outcome states about itself when its emitter repeats it.
 *
 * The control plane confirms a brokered voice session, and the gateway
 * admitted it, so the confirmation may be the first event the fold sees.
 */
const ATTRIBUTED_OUTCOME = {
  ...UNATTRIBUTED_OUTCOME,
  organization_id: "org_1",
  virtual_key_id: "vk_1",
  end_user_id: "end-user-7",
  trace_id: "trace-1",
  request_type: "realtime_session",
  labels: ["customer:acme-172"] as string[],
  metadata: '{"call_site":"summary"}',
};

const admitted = () =>
  makeEvent<GatewaySpendAdmittedEvent>(
    GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
    {
      outcome_carries_attribution: false,
      gateway_request_id: REQUEST,
      occurred_at: T0,
      organization_id: "org_1",
      tenantId: TENANT,
      virtual_key_id: "vk_1",
      principal_user_id: "",
      team_id: "team_1",
      end_user_id: "end-user-7",
      model: "openai/gpt-5",
      model_provider_id: "mp_1",
      trace_id: "trace-1",
      request_type: "chat",
      labels: ["customer:acme-172"],
      metadata: '{"call_site":"summary"}',
      pod_id: "pod-1",
      pod_seq: 42,
    },
    T0,
  );

const confirmed = () =>
  makeEvent<GatewaySpendConfirmedEvent>(
    GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
    {
      gateway_request_id: REQUEST,
      occurred_at: T0 + 3800,
      tenantId: TENANT,
      model: "openai/gpt-5",
      model_provider_id: "mp_1",
      usage: {
        input_tokens: 869,
        output_tokens: 207,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_tokens: 0,
        cache_creation_1h_tokens: 0,
        input_audio_tokens: 0,
        output_audio_tokens: 0,
        input_chars: 0,
        audio_ms: 0,
      },
      cost_nano_usd: CONFIRMED_COST_NANO_USD,
      rate_version: "catalog@2026-07-26",
      duration_ms: 3878,
      ...UNATTRIBUTED_OUTCOME,
    },
    T0 + 3800,
  );

const failed = () =>
  makeEvent<GatewaySpendFailedEvent>(
    GATEWAY_SPEND_FAILED_EVENT_TYPE,
    {
      gateway_request_id: REQUEST,
      occurred_at: T0 + 1500,
      tenantId: TENANT,
      model: "",
      model_provider_id: "",
      error: { type: "provider_timeout", http_status: 504 },
      usage: {
        input_tokens: 869,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_tokens: 0,
        cache_creation_1h_tokens: 0,
        input_audio_tokens: 0,
        output_audio_tokens: 0,
        input_chars: 0,
        audio_ms: 0,
      },
      cost_nano_usd: FAILED_COST_NANO_USD,
      rate_version: "catalog@2026-07-26",
      duration_ms: 1509,
      ...UNATTRIBUTED_OUTCOME,
    },
    T0 + 1500,
  );

const settled = () =>
  makeEvent<GatewaySpendSettledEvent>(
    GATEWAY_SPEND_SETTLED_EVENT_TYPE,
    {
      gateway_request_id: REQUEST,
      occurred_at: T0 + 600_000,
      tenantId: TENANT,
      reason: "confirmation_deadline_expired",
      model: "",
      model_provider_id: "",
      ...UNATTRIBUTED_OUTCOME,
    },
    T0 + 600_000,
  );

function initial(): GatewaySpendState {
  return {
    status: "",
    organizationId: "",
    virtualKeyId: "",
    principalUserId: "",
    endUserId: "",
    model: "",
    providerKey: "",
    traceId: "",
    requestType: "",
    labels: [],
    metadataJson: "",
    podId: "",
    podSeq: 0,
    usage: null,
    rateVersion: "",
    costNanoUsd: 0,
    errorType: "",
    httpStatus: 0,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs: 0,
    durationMs: 0,
    createdAt: T0,
    updatedAt: T0,
    LastEventOccurredAt: T0,
  };
}

describe("gatewaySpend fold", () => {
  /** @scenario The admit command carries attribution into the spend record */
  it("admitted sets attribution, end user, echo, and the admitted status", () => {
    const state = projection.handleGatewaySpendAdmitted(admitted(), initial());
    expect(state.status).toBe("admitted");
    expect(state.organizationId).toBe("org_1");
    expect(state.endUserId).toBe("end-user-7");
    expect(state.metadataJson).toBe('{"call_site":"summary"}');
    expect(state.podSeq).toBe(42);
    expect(state.occurredAtMs).toBe(T0);
  });

  /** @scenario The fold records the price the outcome carried */
  it("confirmed records the event's integer nano-USD and its rate identity", () => {
    const state = projection.handleGatewaySpendConfirmed(
      confirmed(),
      projection.handleGatewaySpendAdmitted(admitted(), initial()),
    );
    expect(state.status).toBe("confirmed");
    expect(state.usage?.input_tokens).toBe(869);
    expect(Number.isInteger(state.costNanoUsd)).toBe(true);
    // The figure is the event's, verbatim: no catalog read happens here,
    // so a catalog deploy cannot move a recorded price.
    expect(state.costNanoUsd).toBe(CONFIRMED_COST_NANO_USD);
    expect(state.rateVersion).toBe("catalog@2026-07-26");
  });

  /** @scenario A redelivered event re-sets the same values */
  it("absolute writes make redelivery a no-op", () => {
    const once = projection.handleGatewaySpendConfirmed(
      confirmed(),
      projection.handleGatewaySpendAdmitted(admitted(), initial()),
    );
    const twice = projection.handleGatewaySpendConfirmed(confirmed(), once);
    expect(twice).toEqual(once);
  });

  /** @scenario Settlement marks the unknown instead of guessing */
  it("settled leaves quantities null and flags reconciliation", () => {
    const state = projection.handleGatewaySpendSettled(
      settled(),
      projection.handleGatewaySpendAdmitted(admitted(), initial()),
    );
    expect(state.status).toBe("settled");
    expect(state.usage).toBeNull();
    expect(state.costNanoUsd).toBe(0);
    expect(state.needsReconciliation).toBe(true);
    expect(state.settleReason).toBe("confirmation_deadline_expired");
  });

  /** @scenario A late confirmation resolves a settled request */
  it("confirmed after settled clears the unknown", () => {
    const settledState = projection.handleGatewaySpendSettled(
      settled(),
      projection.handleGatewaySpendAdmitted(admitted(), initial()),
    );
    const state = projection.handleGatewaySpendConfirmed(
      confirmed(),
      settledState,
    );
    expect(state.status).toBe("confirmed");
    expect(state.needsReconciliation).toBe(false);
    expect(state.settleReason).toBe("");
    expect(state.costNanoUsd).toBeGreaterThan(0);
  });

  /** @scenario A confirmed request never downgrades */
  it("failed and settled after confirmed change nothing", () => {
    const confirmedState = projection.handleGatewaySpendConfirmed(
      confirmed(),
      projection.handleGatewaySpendAdmitted(admitted(), initial()),
    );
    expect(
      projection.handleGatewaySpendFailed(failed(), confirmedState),
    ).toEqual(confirmedState);
    expect(
      projection.handleGatewaySpendSettled(settled(), confirmedState),
    ).toEqual(confirmedState);
  });

  /** @scenario An outcome racing ahead of its admission keeps its status */
  it("a confirmed arriving before admitted is not downgraded by it", () => {
    const early = projection.handleGatewaySpendConfirmed(
      confirmed(),
      initial(),
    );
    expect(early.status).toBe("confirmed");
    const afterAdmit = projection.handleGatewaySpendAdmitted(admitted(), early);
    expect(afterAdmit.status).toBe("confirmed");
    expect(afterAdmit.organizationId).toBe("org_1");
    // The resolved identity and the price the outcome carried survive the
    // late admission; only attribution fills in.
    expect(afterAdmit.model).toBe(early.model);
    expect(afterAdmit.providerKey).toBe(early.providerKey);
    expect(afterAdmit.costNanoUsd).toBe(early.costNanoUsd);
  });

  /** @scenario An outcome racing ahead of its admission keeps its status */
  it("a settled arriving before admitted still adopts the admission's identity", () => {
    const early = projection.handleGatewaySpendSettled(settled(), initial());
    expect(early.status).toBe("settled");
    // Settlement resolves no identity, so the late admission's requested
    // model and provider must fill in rather than being pinned to "".
    const afterAdmit = projection.handleGatewaySpendAdmitted(admitted(), early);
    expect(afterAdmit.status).toBe("settled");
    expect(afterAdmit.model).toBe("openai/gpt-5");
    expect(afterAdmit.providerKey).not.toBe("");
    expect(afterAdmit.needsReconciliation).toBe(true);
  });

  /** @scenario Partial usage on a failure still prices */
  it("failed records the price of the tokens consumed before the failure", () => {
    const state = projection.handleGatewaySpendFailed(
      failed(),
      projection.handleGatewaySpendAdmitted(admitted(), initial()),
    );
    expect(state.status).toBe("failed");
    expect(state.errorType).toBe("provider_timeout");
    expect(state.httpStatus).toBe(504);
    expect(state.costNanoUsd).toBe(FAILED_COST_NANO_USD);
    expect(Number.isInteger(state.costNanoUsd)).toBe(true);
  });
  /** @scenario An outcome states the attribution its admission has not delivered */
  it("names the organization and the key from an outcome that has no admission", () => {
    const state = projection.handleGatewaySpendConfirmed(
      makeEvent<GatewaySpendConfirmedEvent>(
        GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        { ...confirmed().data, ...ATTRIBUTED_OUTCOME },
        T0 + 3800,
      ),
      initial(),
    );

    // Priced and named. Without the outcome's own attribution this row is a
    // real charge belonging to no organization and no key, which is what a
    // brokered voice session produced: the gateway admits it and the control
    // plane confirms it, so the confirmation can reach the fold first.
    expect(state.costNanoUsd).toBe(CONFIRMED_COST_NANO_USD);
    expect(state.organizationId).toBe("org_1");
    expect(state.virtualKeyId).toBe("vk_1");
    expect(state.requestType).toBe("realtime_session");
    expect(state.traceId).toBe("trace-1");
    expect(state.endUserId).toBe("end-user-7");
    expect(state.labels).toEqual(["customer:acme-172"]);
  });

  /** @scenario An outcome states the attribution its admission has not delivered */
  it("does not let a late admission erase what the outcome stated", () => {
    // The trace id is only known once the customer span opens, which happens
    // after admission, so an admission carries none. A brokered voice session
    // is confirmed by the control plane and can fold first, and an admission
    // that overwrote unconditionally would blank the trace the settlement had
    // just named, breaking the join between the spend row and the trace.
    const early = projection.handleGatewaySpendConfirmed(
      makeEvent<GatewaySpendConfirmedEvent>(
        GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        { ...confirmed().data, ...ATTRIBUTED_OUTCOME },
        T0 + 3800,
      ),
      initial(),
    );

    const admitWithoutTrace = makeEvent<GatewaySpendAdmittedEvent>(
      GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
      { ...admitted().data, trace_id: "" },
      T0,
    );

    expect(
      projection.handleGatewaySpendAdmitted(admitWithoutTrace, early).traceId,
    ).toBe("trace-1");
  });

  /** @scenario An outcome states the attribution its admission has not delivered */
  it("lets the admission win over what the outcome stated", () => {
    const early = projection.handleGatewaySpendConfirmed(
      makeEvent<GatewaySpendConfirmedEvent>(
        GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        {
          ...confirmed().data,
          ...ATTRIBUTED_OUTCOME,
          organization_id: "org_stale",
        },
        T0 + 3800,
      ),
      initial(),
    );
    expect(early.organizationId).toBe("org_stale");

    // Admission is the authority. The outcome only fills a gap.
    expect(
      projection.handleGatewaySpendAdmitted(admitted(), early).organizationId,
    ).toBe("org_1");
  });
});
