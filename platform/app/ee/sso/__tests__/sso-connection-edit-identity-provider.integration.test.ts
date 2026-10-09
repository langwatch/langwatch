// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SsoConnectionStateFoldProjection } from "@ee/event-sourcing/pipelines/sso-connections/projections/ssoConnectionState.foldProjection";
import {
  CONNECTION_IDP_UPDATED_EVENT_TYPE,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionState,
} from "@langwatch/identity";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing";
import { PrismaSsoConnectionIssuers } from "../sso-connection-issuers.prisma.repository";
import { PrismaSsoConnectionProjectionRepository } from "../sso-connection-projection.prisma.repository";
import { engineProviderFor } from "../sso-engine-provider";
import { plaintextProviderConfigCipher } from "../sso-provider-config";
import { InMemoryCredentials } from "./support/sso-self-serve.fixture";

/**
 * An identity provider update rewrites what the engine dials, on the same
 * provider row (specs/identity/sso-connection-edit-identity-provider.feature).
 *
 * The engine's `SsoProvider` row is derived from the connection head on every
 * apply, and the issuer list behind the trusted-origin allowlist reads that
 * row. So the update is only real once the row carries the new issuer and
 * credentials under the same id: the id is what the callback route
 * `/api/auth/sso/callback/<connection id>` names.
 */

const RUN = `${Date.now()}`;
const ORG = `org_idp_edit_${RUN}`;
const CONNECTION = `ssoc_idp_edit_${RUN}`;
const WRONG = "https://login.microsoftonline.com/wrong-tenant/v2.0";
const RIGHT = "https://login.microsoftonline.com/right-tenant/v2.0";
const T0 = 1_756_000_000_000;

const credentials = new InMemoryCredentials();
const store = new PrismaSsoConnectionProjectionRepository(
  prisma,
  ({ connection }) =>
    engineProviderFor({
      connection,
      credentials,
      baseUrl: "https://app.langwatch.test",
      providerConfig: plaintextProviderConfigCipher,
    }),
);
const version = new SsoConnectionStateFoldProjection({ store }).version;

async function storeHead(state: SsoConnectionState, eventId: string) {
  await store.store(
    {
      state: {
        ...state,
        CreatedAt: state.createdAtMs,
        UpdatedAt: state.updatedAtMs,
        LastEventOccurredAt: state.updatedAtMs,
      },
      cursor: { acceptedAt: state.updatedAtMs, eventId },
      occurredAt: state.updatedAtMs,
      createdAt: state.createdAtMs,
      updatedAt: state.updatedAtMs,
      version,
    },
    { aggregateId: CONNECTION, tenantId: createTenantId(ORG) },
  );
}

const put = (kind: "oidc-client-id" | "oidc-client-secret", value: string) =>
  credentials.put({
    organizationId: ORG,
    connectionId: CONNECTION,
    kind,
    value,
  });

async function cleanUp() {
  await prisma.ssoProvider.deleteMany({ where: { id: CONNECTION } });
  await prisma.ssoConnection.deleteMany({ where: { organizationId: ORG } });
}

beforeEach(cleanUp);
afterAll(cleanUp);

describe("the engine row after an identity provider update", () => {
  describe("given a live connection registered with a wrong issuer", () => {
    describe("when its identity provider settings are replaced", () => {
      /** @scenario "Editing the identity provider keeps the connection id and redirect address" */
      it("rewrites the issuer and credentials on the same provider row", async () => {
        const registered: SsoConnectionState = {
          ...emptySsoConnection({ connectionId: CONNECTION }),
          organizationId: ORG,
          type: "oidc",
          state: "ACTIVE",
          source: "self-serve",
          idpMetadata: {
            issuer: WRONG,
            providerId: "Acme Entra",
            clientIdRef: await put("oidc-client-id", "client_old"),
            secretRef: await put("oidc-client-secret", "secret_old"),
            certRefs: [],
          },
          createdAtMs: T0,
          updatedAtMs: T0,
        };
        await storeHead(registered, `evt_registered_${RUN}`);

        const updated = reduceSsoConnection({
          state: registered,
          fact: {
            type: CONNECTION_IDP_UPDATED_EVENT_TYPE,
            occurredAt: T0 + 1_000,
            data: {
              connectionId: CONNECTION,
              idp: {
                issuer: RIGHT,
                clientIdRef: await put("oidc-client-id", "client_new"),
                secretRef: registered.idpMetadata.secretRef,
                certRefs: [],
              },
              actor: { type: "user", id: "user_ana" },
              source: "self-serve",
            },
          },
        });
        await storeHead(updated, `evt_idp_updated_${RUN}`);

        const rows = await prisma.ssoProvider.findMany({
          where: { organizationId: ORG },
        });
        expect(rows).toHaveLength(1);
        const [row] = rows;
        expect(row?.id).toBe(CONNECTION);
        expect(row?.providerId).toBe(CONNECTION);
        expect(row?.issuer).toBe(RIGHT);
        expect(JSON.parse(row?.oidcConfig ?? "{}")).toMatchObject({
          clientId: "client_new",
          clientSecret: "secret_old",
          discoveryEndpoint: `${RIGHT}/.well-known/openid-configuration`,
        });

        // What the trusted-origin allowlist asks for a callback naming this
        // connection.
        await expect(
          new PrismaSsoConnectionIssuers(prisma).findIssuerForConnection({
            connectionId: CONNECTION,
          }),
        ).resolves.toBe(RIGHT);
      });
    });
  });
});
