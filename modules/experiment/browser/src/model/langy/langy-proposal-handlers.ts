/**
 * What a page hands Langy so the agent can apply a proposal on it. Declared
 * here, not beside the message component, since only the shape is shared
 * between the page's registration hook and the panel that shows the result.
 */

/** What the page offers the reader once a proposal has been applied. */
export type AppliedOutcome =
  | {
      label?: string;
      onOpen?: () => void;
      href?: string;
    }
  | undefined;

/** The proposals this page can apply, by proposal kind. */
export type ProposalHandlers = Record<
  string,
  (payload: Record<string, unknown>) => Promise<AppliedOutcome>
>;
