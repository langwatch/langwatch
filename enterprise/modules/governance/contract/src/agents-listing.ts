export type AgentsListingRefusalCause = "access" | "unreachable" | "incomplete";

export type AgentsListingOutcome =
  | { outcome: "listed" }
  | { outcome: "refused"; cause: AgentsListingRefusalCause };
