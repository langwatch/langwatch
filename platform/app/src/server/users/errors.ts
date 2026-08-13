import { HandledError } from "@langwatch/handled-error";

/**
 * The address being signed up already has a LangWatch account.
 *
 * Handled rather than generic because the screen has a real move to offer:
 * this is almost never a stranger's address, it is the person's own account.
 * Sign-up is two calls, one writes the User row and its password, the second
 * exchanges them for a session, and only the first is durable, so a failure in
 * the second leaves an account nobody mentions. Every retry lands here. It is
 * also where someone who was a member before, was removed, and got invited back
 * ends up, because an invite asks them to create an account they already have.
 *
 * The wording deliberately confirms the address is registered. Sign-up cannot
 * avoid saying so, the alternative is silently refusing to create an account
 * and explaining nothing, and the sign-in retry the client runs off this code
 * is bounded by the same rate limit as the sign-in screen, so it hands a guesser
 * nothing the sign-in form does not already.
 */
export class EmailAlreadyRegisteredError extends HandledError {
  declare readonly code: "email_already_registered";

  constructor() {
    super(
      "email_already_registered",
      "An account with this email already exists",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "EmailAlreadyRegisteredError";
  }
}
