// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: enterprise/modules/scim/specs/scim-sso-connection-view.feature
 */
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSourcing,
  replayProjectionsOf,
  sealPipelineDefinition,
} from "@langwatch/eventing";
import { EventStoreMemory, testEventSchema } from "@langwatch/eventing/testing";
import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  connectionActivatedPayloadSchema,
  connectionRegisteredPayloadSchema,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionFact,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
  VERIFICATION_REQUESTED_EVENT_TYPE,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { MemoryScimSsoConnectionRepository } from "../../repositories/memory/memory.scim-sso-connection.repository.ts";
import {
  type ScimSsoConnectionFoldState,
  scimSsoConnectionFoldStateSchema,
} from "../../repositories/scim-sso-connection.repository.ts";
import { ScimConnectionsService } from "../../services/scim-connections.service.ts";
import {
  buildScimSsoConnectionPipeline,
  SCIM_SSO_CONNECTION_PIPELINE_NAME,
} from "../scim-sso-connection.pipeline.ts";
import {
  SCIM_SSO_CONNECTION_PROJECTION_NAME,
  scimSsoConnectionPeerEvents,
} from "../scim-sso-connection.projection.ts";

const LANE = `${SCIM_SSO_CONNECTION_PIPELINE_NAME}.${SCIM_SSO_CONNECTION_PROJECTION_NAME}`;
const actor = { type: "user" as const, id: "user_ana" };
const registeredSchema = testEventSchema(
  CONNECTION_REGISTERED_EVENT_TYPE,
  connectionRegisteredPayloadSchema,
);
const activatedSchema = testEventSchema(
  CONNECTION_ACTIVATED_EVENT_TYPE,
  connectionActivatedPayloadSchema,
);

/** Identity's connection pipeline as a stand-in owner: its event types, parsed by its contract. */
function identityStandIn() {
  return definePipeline({
    name: SSO_CONNECTION_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SSO_CONNECTION_AGGREGATE_TYPE }),
  })
    .withEvents(scimSsoConnectionPeerEvents.map(({ type, data }) => testEventSchema(type, data)))
    .build();
}

interface FactAt {
  id: string;
  connectionId: string;
  organizationId: string;
  occurredAt: number;
}

function envelope({ id, connectionId, organizationId, occurredAt }: FactAt) {
  return {
    id,
    aggregateId: connectionId,
    aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
    tenantId: createTenantId(organizationId),
    version: "2026-08-24",
    createdAt: occurredAt,
    occurredAt,
  };
}

function registered({
  providerId,
  ...at
}: FactAt & { providerId: string }): z.infer<typeof registeredSchema> {
  return {
    ...envelope(at),
    type: CONNECTION_REGISTERED_EVENT_TYPE,
    data: {
      connectionId: at.connectionId,
      organizationId: at.organizationId,
      type: "oidc",
      idp: { issuer: null, providerId, clientIdRef: null, secretRef: null, certRefs: [] },
      arrivalPolicy: "refuse",
      actor,
      source: "self-serve",
    },
  };
}

function activated(at: FactAt): z.infer<typeof activatedSchema> {
  return {
    ...envelope(at),
    type: CONNECTION_ACTIVATED_EVENT_TYPE,
    data: {
      connectionId: at.connectionId,
      testLoginAccountId: "account_1",
      actor,
      source: "self-serve",
    },
  };
}

describe("SCIM's fold of identity's SSO connection facts", () => {
  /** @scenario "SCIM lists the connections it folded from identity's facts" */
  it("lists the organization's folded connections, named by provider, and no other organization's", async () => {
    const store = MemoryScimSsoConnectionRepository.create();
    const eventSourcing = EventSourcing.createWithStores({
      eventStore: EventStoreMemory.createForTesting(),
    });
    eventSourcing.register(buildScimSsoConnectionPipeline(store));
    const identity = eventSourcing.register(identityStandIn());

    // One fact at a time, as the eventing exemplar does: the in-memory runtime
    // does not order a batch per aggregate, the queue's group key does in production.
    for (const event of [
      registered({
        id: "e1",
        connectionId: "conn_okta",
        organizationId: "org_acme",
        providerId: "Okta",
        occurredAt: 10,
      }),
      activated({
        id: "e2",
        connectionId: "conn_okta",
        organizationId: "org_acme",
        occurredAt: 20,
      }),
      registered({
        id: "e3",
        connectionId: "conn_other",
        organizationId: "org_other",
        providerId: "Entra",
        occurredAt: 15,
      }),
    ]) {
      await identity.service.storeEvents([event], { tenantId: event.tenantId });
      await vi.waitFor(async () =>
        expect((await store.getWithApplied(event.aggregateId)).appliedEventIds).toContain(event.id),
      );
    }
    const connections = ScimConnectionsService.create(store);

    await vi.waitFor(async () =>
      expect(await connections.findConnections({ organizationId: "org_acme" })).toEqual([
        { connectionId: "conn_okta", displayName: "Okta", type: "oidc", state: "ACTIVE" },
      ]),
    );
    await eventSourcing.close();
  });

  /** @scenario "SCIM's connection list lags identity until the fold catches up" */
  it("answers an empty list from its own rows before the fold has folded anything", async () => {
    const store = MemoryScimSsoConnectionRepository.create();
    const read = vi.spyOn(store, "findForOrganization");

    const listed = await ScimConnectionsService.create(store).findConnections({
      organizationId: "org_acme",
    });

    expect(listed).toEqual([]);
    expect(read).toHaveBeenCalledWith({ organizationId: "org_acme" });
  });
});

describe("a projection replay of SCIM's connection fold", () => {
  const definitions = [
    sealPipelineDefinition(identityStandIn()),
    sealPipelineDefinition(
      buildScimSsoConnectionPipeline(MemoryScimSsoConnectionRepository.create()),
    ),
  ];

  /** @scenario "A projection replay rebuilds SCIM's connection list from identity's event log" */
  it("lists SCIM's lane under identity's connection aggregate type", () => {
    const fold = replayProjectionsOf(definitions).projections.find(
      ({ projectionName }) => projectionName === LANE,
    );

    expect(fold).toMatchObject({
      source: "global",
      aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
      pauseKey: `global/projection/${LANE}`,
      kind: "fold",
    });
  });

  /** @scenario "A projection replay rebuilds SCIM's connection list from identity's event log" */
  it("folds identity's stored facts into the connection live delivery folds", () => {
    const fold = replayProjectionsOf(definitions).projections.find(
      ({ projectionName }) => projectionName === LANE,
    );
    const stream = [
      registered({
        id: "e1",
        connectionId: "conn_okta",
        organizationId: "org_acme",
        providerId: "Okta",
        occurredAt: 10,
      }),
      activated({
        id: "e2",
        connectionId: "conn_okta",
        organizationId: "org_acme",
        occurredAt: 20,
      }),
    ];

    const rebuilt = fold?.open((definition) =>
      stream.reduce((state, event) => definition.apply(state, event), definition.init()),
    );

    expect(rebuilt).toMatchObject({
      connectionId: "conn_okta",
      organizationId: "org_acme",
      state: "ACTIVE",
      idpMetadata: { providerId: "Okta" },
      LastEventOccurredAt: 20,
    });
  });
});

describe("the stored state of SCIM's connection fold", () => {
  const by = { actor, source: "self-serve" as const };
  const conn = { connectionId: "conn_okta" };

  function foldedFrom(facts: SsoConnectionFact[]): ScimSsoConnectionFoldState {
    const state = facts.reduce(
      (folded, fact) => reduceSsoConnection({ state: folded, fact }),
      emptySsoConnection(conn),
    );
    return { ...state, LastEventOccurredAt: facts.at(-1)?.occurredAt ?? 0 };
  }

  const readBack = (state: ScimSsoConnectionFoldState) =>
    scimSsoConnectionFoldStateSchema.parse(JSON.parse(JSON.stringify(state)));

  /** @scenario "SCIM reads back every connection state identity's reducer folds" */
  it("reads back a connection folded through a rejection, an attestation and a ceremony", () => {
    const claimed = (domain: string, occurredAt: number): SsoConnectionFact => ({
      type: DOMAIN_CLAIMED_EVENT_TYPE,
      occurredAt,
      data: { ...conn, domain, ...by },
    });
    const approved = (domain: string, occurredAt: number): SsoConnectionFact => ({
      type: DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
      occurredAt,
      data: { ...conn, domain, authority: "platform-operator", ...by },
    });
    const state = foldedFrom([
      {
        type: CONNECTION_REGISTERED_EVENT_TYPE,
        occurredAt: 10,
        data: {
          ...conn,
          organizationId: "org_acme",
          type: "saml",
          idp: {
            issuer: "https://idp.example",
            providerId: "Okta",
            clientIdRef: "cred_client",
            secretRef: "cred_secret",
            certRefs: ["cert_1"],
          },
          arrivalPolicy: "refuse",
          ...by,
        },
      },
      claimed("acme.com", 20),
      {
        type: DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
        occurredAt: 30,
        data: { ...conn, domain: "acme.com", note: "prove it first", ...by },
      },
      claimed("acme.com", 40),
      claimed("beta.com", 41),
      approved("acme.com", 50),
      approved("beta.com", 51),
      {
        type: DOMAIN_ATTESTED_EVENT_TYPE,
        occurredAt: 60,
        data: { ...conn, domain: "acme.com", evidenceRef: "case_1", note: "checked", ...by },
      },
      {
        type: VERIFICATION_REQUESTED_EVENT_TYPE,
        occurredAt: 70,
        data: {
          ...conn,
          domain: "beta.com",
          method: "dns-txt",
          tokenHash: "sha256:abc",
          expiresAtMs: 1_000,
          ...by,
        },
      },
      claimed("gamma.com", 80),
      {
        type: DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
        occurredAt: 90,
        data: { ...conn, domain: "gamma.com", note: "not yours", ...by },
      },
    ]);

    expect(state).toMatchObject({
      rejection: { domain: "gamma.com", note: "not yours" },
      domainVerifications: [{ domain: "acme.com", evidenceRef: "case_1" }],
      pendingVerification: { domain: "beta.com", expiresAtMs: 1_000 },
    });
    expect(readBack(state)).toEqual(state);
  });

  /** @scenario "SCIM reads back every connection state identity's reducer folds" */
  it("reads back a connection whose first folded fact was not its registration", () => {
    const state = foldedFrom([
      {
        type: DOMAIN_CLAIMED_EVENT_TYPE,
        occurredAt: 20,
        data: { ...conn, domain: "acme.com", ...by },
      },
    ]);

    expect(state.idpMetadata.providerId).toBe("");
    expect(readBack(state)).toEqual(state);
  });
});
