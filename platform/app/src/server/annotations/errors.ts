import { HandledError } from "@langwatch/handled-error";

/**
 * An annotator string named neither a queue nor a person.
 *
 * Annotators travel as one prefixed string (`queue-<id>` / `user-<id>`) so a
 * queue and a person can share one field. Anything else is unusable, and there
 * are two ways to arrive at one: a client sent it, or an automation's stored
 * `actionParams` still hold a value from before the prefix convention.
 *
 * Handled rather than plain because both causes are nameable and both are
 * fixable by a person — re-pick the annotator, or edit the automation. The
 * second caller is the reason it must not be a transport error: it is raised
 * inside the process-manager outbox, where a `TRPCError` reaches an operator
 * as a dead-lettered row with a class name that means nothing.
 */
export class InvalidAnnotatorReferenceError extends HandledError {
  declare readonly code: "invalid_annotator_reference";

  constructor(annotator: string) {
    // The offending value is the customer's own input, echoed back so the log
    // line and the REST body both name what to fix. No `meta`: nothing renders
    // an annotator, and `meta` is a client contract rather than a scratchpad.
    super(
      "invalid_annotator_reference",
      `Annotator "${annotator}" names neither a queue nor a person.`,
      { httpStatus: 422, fault: "customer" },
    );
    this.name = "InvalidAnnotatorReferenceError";
  }
}
