/**
 * One live connection of each kind per organization: the early refusal a registration meets.
 * @see specs/identity/sso-idp-termination.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { emptySsoConnection, type SsoConnectionState } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import type { SsoConnectionRegistrationRepository } from "../../repositories/sso-connection-registration.repository.ts";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "../../repositories/sso-connection.repository.ts";
import { SsoConnectionGuardChecksService } from "../sso-connection-guard-checks.service.ts";

const ACME = "org_acme";

function held(connectionId: string, state: SsoConnectionState["state"]): SsoConnectionState {
  return { ...emptySsoConnection({ connectionId }), organizationId: ACME, state };
}

function checksOver(connections: SsoConnectionState[]) {
  return SsoConnectionGuardChecksService.create({
    connections: createApiFixture<SsoConnectionReadRepository>({
      findForOrganization: async () => connections,
    }),
    registrationSlots: createApiFixture<SsoConnectionRegistrationRepository>(),
    breakGlass: createApiFixture<SsoBreakGlassBindingRepository>(),
    stranding: createApiFixture<SsoConnectionStrandingRepository>(),
    platformOperators: createApiFixture<SsoPlatformOperatorRepository>(),
  });
}

const registering = { organizationId: ACME, connectionId: "ssoc_new", kind: "direct" } as const;

describe("registering an identity provider", () => {
  /** @scenario "An organization holds one identity provider at a time" */
  it("is refused while the organization already holds a connection", async () => {
    const checks = checksOver([held("ssoc_old", "ACTIVE")]);

    await expect(checks.refuseCompetingConnection(registering)).rejects.toMatchObject({
      code: "sso_connection_already_registered",
    });
  });

  /** @scenario "A discarded connection is not one it still holds" */
  it("goes ahead when the organization's only connection was discarded", async () => {
    const checks = checksOver([held("ssoc_old", "DISCARDED")]);

    await expect(checks.refuseCompetingConnection(registering)).resolves.toBeUndefined();
  });
});
