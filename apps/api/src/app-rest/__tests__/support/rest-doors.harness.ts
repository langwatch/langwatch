/**
 * The process's door registry, opened over whatever a suite composed for it.
 * One helper rather than a runtime per suite: a test that built its own runtime
 * would be testing a door this process does not open.
 */
import type { MountableRestApp } from "@langwatch/api/rest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import {
  openApiRestDoors,
  type ApiRestAbsenceReport,
  type ApiRestDoorContext,
} from "../../api-rest.doors.ts";
import {
  createApiRestRuntime,
  type ApiOrganizationCredentialPort,
  type ApiOrganizationIdentityPort,
  type ApiRestRouteAuthorizationPort,
  type ApiRestRuntime,
  type ApiScimDirectoryCredentialPort,
} from "../../api-rest.runtime.ts";
import type { ApiPackagedRestCollaborators } from "../../api-rest.packaged-services.ts";
import type { ApiRestPorts, ApiRestServices } from "../../api-rest.services.ts";

/**
 * The process's own runtime, for a suite that drives ONE family's mount rather
 * than the whole registry. Its project door refuses: a suite reaching it is a
 * family authenticating somewhere its declaration did not say.
 */
export function openTestRestRuntime(): ApiRestRuntime {
  return createApiRestRuntime({
    projectCredential: () => {
      throw new Error("This suite composed no project credential door.");
    },
    organizationCredential: () => {
      throw new Error("This suite composed no organization credential door.");
    },
    organizationIdentity: () => {
      throw new Error("This suite composed no organization credential door.");
    },
    routeAuthorization: () => {
      throw new Error("This suite authorizes no route-scoped permission.");
    },
    directoryCredential: () => {
      throw new Error("This suite verifies no directory bearer.");
    },
    errors: ApiRestObservabilityComposition.create().legacyErrorHandler,
  });
}

/** Opens every door the given services and ports compose, and no other. */
export function openTestRestDoors(options: {
  services?: ApiRestServices | undefined;
  ports?: Partial<ApiRestPorts> | undefined;
  packaged?: ApiPackagedRestCollaborators | undefined;
  absence?: ApiRestAbsenceReport | undefined;
  /** The organization door, for a suite driving a family that answers behind one. */
  organizationCredential?: ApiOrganizationCredentialPort | undefined;
  /** The same door with no permission asked, for a family that answers any caller. */
  organizationIdentity?: ApiOrganizationIdentityPort | undefined;
  /** The permission a route asks at the project its own path names. */
  routeAuthorization?: ApiRestRouteAuthorizationPort | undefined;
  /** The directory bearer, for a suite driving the SCIM 2.0 protocol family. */
  directoryCredential?: ApiScimDirectoryCredentialPort | undefined;
}): MountableRestApp[] {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const dualCredential = options.packaged?.ports.dualAuth;
  const ports = {
    handlerManagedCredential: () => {
      throw new Error("This suite composed no project credential door.");
    },
    rateLimit: async () => ({ allowed: true }),
    errors,
    platformUrl: ({ projectSlug, path }: { projectSlug: string; path: string }) =>
      `https://app.langwatch.test/${projectSlug}${path}`,
    ...options.ports,
  } as ApiRestPorts;
  const context: ApiRestDoorContext = {
    runtime: createApiRestRuntime({
      projectCredential: (input) => ports.handlerManagedCredential(input),
      organizationCredential:
        options.organizationCredential ??
        (() => {
          throw new Error("This suite composed no organization credential door.");
        }),
      organizationIdentity:
        options.organizationIdentity ??
        (() => {
          throw new Error("This suite composed no organization credential door.");
        }),
      routeAuthorization:
        options.routeAuthorization ??
        (() => {
          throw new Error("This suite authorizes no route-scoped permission.");
        }),
      directoryCredential:
        options.directoryCredential ??
        (() => {
          throw new Error("This suite verifies no directory bearer.");
        }),
      errors,
      ...(dualCredential ? { dualCredential } : {}),
    }),
    services: options.services ?? {},
    ports,
    packaged: options.packaged,
  };

  return openApiRestDoors({ context, ...(options.absence ? { report: options.absence } : {}) });
}
