/**
 * A version 1 registration, as the log stored it, replayed through the connection pipeline's own
 * parse (the one its queue, event store reads and replays apply) and folded into the connection.
 * Spec: modules/identity/specs/sso-connection-legacy-registration.feature
 */
import {
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_REGISTERED_V1_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { ConnectedIdentityEventing } from "../eventing/identity-command-senders.store.ts";
import {
  SsoConnectionStateFoldProjection,
  type SsoConnectionEvent,
  type SsoConnectionFoldState,
} from "../features/sso-connection/eventing/sso-connection-state.projection.ts";
import { composeSsoConnectionGraph } from "../features/sso-connection/eventing/sso-connection.pipeline.ts";
import {
  licensingFixture,
  StubBreakGlassBindings,
  StubPlatformOperators,
} from "./support/in-memory-connections.ts";
import { liveRepositories } from "./support/live-repositories.ts";

/** The models the connection graph reads, none of them touched by a parse or a fold. */
function testDatabase(): PrismaClient {
  const model = { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() };
  return prismaDouble({ ssoConnection: model, user: model, organization: model });
}

function connectionPipeline() {
  return composeSsoConnectionGraph({
    repositories: liveRepositories(testDatabase()),
    breakGlass: new StubBreakGlassBindings(true),
    commands: ConnectedIdentityEventing.create(),
    directoryMove: { migrationFinalized: async () => {} },
    licensing: licensingFixture(),
    authorization: new StubPlatformOperators(),
  }).pipeline();
}

/** A registration row as the event log holds it, under the given type. */
function storedRegistration({
  type = CONNECTION_REGISTERED_V1_EVENT_TYPE,
  extra,
}: {
  type?: string;
  extra: Record<string, unknown>;
}) {
  return {
    id: "evt_0001",
    aggregateId: "ssoconn_acme",
    aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
    tenantId: "org_acme",
    type,
    version: "2026-08-24",
    data: {
      connectionId: "ssoconn_acme",
      organizationId: "org_acme",
      type: "oidc",
      idp: { issuer: null, providerId: "Okta", clientIdRef: null, secretRef: null, certRefs: [] },
      actor: { type: "user", id: "user_ana" },
      source: "legacy-grandfathered",
      ...extra,
    },
    metadata: {},
    occurredAt: 1,
    createdAt: 1,
  };
}

/** Parses the stored row as the pipeline does, then folds it into an empty connection. */
function replay(stored: ReturnType<typeof storedRegistration>) {
  const event = connectionPipeline().parseEvent(stored) as SsoConnectionEvent;
  const projection = new SsoConnectionStateFoldProjection({
    store: { get: async () => ({ kind: "empty" }), store: async () => {} },
  });
  const initial: SsoConnectionFoldState = {
    ...projection.init(),
    CreatedAt: 0,
    UpdatedAt: 0,
    LastEventOccurredAt: 0,
  };
  return { event, state: projection.apply(initial, event) };
}

describe("given a version 1 registration stored before the arrival policy existed", () => {
  describe("when it provisioned unknown people and is replayed through the pipeline", () => {
    /** @scenario "A registration that let unknown people in reads as admitting them" */
    it("reads as a version 2 registration admitting them", () => {
      const { event, state } = replay(storedRegistration({ extra: { allowsJit: true } }));

      expect(event.type).toBe(CONNECTION_REGISTERED_EVENT_TYPE);
      expect(event.data).toMatchObject({ arrivalPolicy: "admit" });
      expect(event.data).not.toHaveProperty("allowsJit");
      expect(state.arrivalPolicy).toBe("admit");
    });
  });

  describe("when it provisioned nobody", () => {
    /** @scenario "A registration that kept unknown people out reads as refusing them" */
    it("reads as refusing them", () => {
      expect(replay(storedRegistration({ extra: { allowsJit: false } })).state.arrivalPolicy).toBe(
        "refuse",
      );
    });
  });

  describe("when it states neither", () => {
    /** @scenario "A registration that states neither reads as the default policy" */
    it("reads as the default policy", () => {
      expect(replay(storedRegistration({ extra: {} })).state.arrivalPolicy).toBe("refuse");
      expect(
        replay(storedRegistration({ extra: { arrivalPolicy: null } })).state.arrivalPolicy,
      ).toBe("refuse");
    });
  });
});

describe("given a registration that states an arrival policy", () => {
  /** @scenario "A registration that states an arrival policy reads as written" */
  it("reads as written in either version, and refuses a policy outside the three answers", () => {
    const v1 = storedRegistration({ extra: { arrivalPolicy: "request", allowsJit: true } });
    const v2 = storedRegistration({
      type: CONNECTION_REGISTERED_EVENT_TYPE,
      extra: { arrivalPolicy: "request" },
    });

    expect(replay(v1).state.arrivalPolicy).toBe("request");
    expect(replay(v2).state.arrivalPolicy).toBe("request");
    // The exact issue (code and path) is pinned by the contract's registration-v1 unit test;
    // here the pipeline only has to refuse.
    expect(() => replay(storedRegistration({ extra: { arrivalPolicy: "auto" } }))).toThrow(
      /arrivalPolicy/,
    );
    expect(() =>
      replay(
        storedRegistration({
          type: CONNECTION_REGISTERED_EVENT_TYPE,
          extra: { arrivalPolicy: "auto" },
        }),
      ),
    ).toThrow(/arrivalPolicy/);
  });
});
