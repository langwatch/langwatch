import { generate } from "@langwatch/ksuid";

// A binding's id is caller-minted, in the persisted format shared across processes.
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

/** The id a new role binding gets: one scheme, minted by whoever calls `attachBindings`. */
export const newAuthzBindingId = (): string => generate(ROLE_BINDING_KSUID_RESOURCE).toString();
