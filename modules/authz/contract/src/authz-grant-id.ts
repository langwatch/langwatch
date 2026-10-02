import { generate } from "@langwatch/ksuid";

// A binding's id is caller-minted, in the persisted format shared across processes.
const GRANT_KSUID_RESOURCE = "rolebinding";

/** The id a new role binding gets: one scheme, minted by whoever calls `attachBindings`. */
export const newAuthzGrantId = (): string => generate(GRANT_KSUID_RESOURCE).toString();
