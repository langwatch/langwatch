/**
 * The connection pipeline's upcast: every stored version 1 registration reads as version 2,
 * through the contract's version 1 transform.
 * Spec: modules/identity/specs/sso-connection-legacy-registration.feature
 */
import type { EventUpcast } from "@langwatch/eventing";
import { CONNECTION_REGISTERED_EVENT_TYPE } from "@langwatch/identity-contract";
import {
  CONNECTION_REGISTERED_V1_EVENT_TYPE,
  registrationFromV1,
} from "@langwatch/identity-contract/sso-connection-registration-v1";

/** The connection pipeline's upcast: version 1 registrations read as version 2. */
export const CONNECTION_REGISTERED_V1_UPCAST = {
  from: { type: CONNECTION_REGISTERED_V1_EVENT_TYPE },
  to: CONNECTION_REGISTERED_EVENT_TYPE,
  data: registrationFromV1,
} as const satisfies EventUpcast<typeof CONNECTION_REGISTERED_EVENT_TYPE>;
