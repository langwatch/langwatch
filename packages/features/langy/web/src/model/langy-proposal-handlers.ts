/**
 * What a page hands Langy so the agent can apply a proposal on it.
 *
 * Declared here rather than beside the message component that renders a
 * proposal, because the registration hook a page calls and the panel that
 * shows the result are different layers and only the shape is shared.
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
