import { Alert } from "@chakra-ui/react";
import type { SsoSelfServeAvailability } from "@langwatch/identity-server";
import { explainAnyError } from "~/features/errors/logic/presentation";
import { toaster } from "../../ui/toaster";

/**
 * How single sign-on setup reports a failure, in one place.
 *
 * Both of these read the CODE-keyed registry and never `error.message`: since
 * #5984 the wire message for a handled error is the code, so rendering it
 * would show an administrator `sso_activation_break_glass_missing`.
 */

/**
 * A read that failed, said out loud.
 *
 * Never an empty list and never a silent nothing: "we could not find out" and
 * "there is nothing here" are different facts, and showing the second when
 * the first is true is how somebody concludes their way back in vanished.
 */
export function LoadFailure({ error, what }: { error: unknown; what: string }) {
  const copy = explainAnyError(error);
  return (
    <Alert.Root status="error">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{copy.title}</Alert.Title>
        <Alert.Description>
          {copy.description} We could not load {what}.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/** What the reader is told when setting single sign-on up is not theirs yet. */
const REFUSAL_COPY = {
  license_required: {
    title: "Single sign-on needs an active licence",
    body: "Activate an enterprise licence on this installation, then restart it, and you can set single sign-on up here.",
  },
  license_restart_required: {
    title: "Restart to finish activating single sign-on",
    body: "The licence is active. This installation decides what it federates when it starts, so single sign-on becomes available after the next restart.",
  },
  not_opted_in: {
    title: "Setting single sign-on up yourself isn't switched on yet",
    body: "Talk to us and we'll set your connection up with you, or switch this on for your organization.",
  },
} as const;

/**
 * Why setting single sign-on up is not available here, and what to do about
 * it.
 *
 * A banner rather than the whole screen. An administrator who cannot start
 * the journey today still came to find out how their organization signs in,
 * and a page whose entire content is a refusal answers nothing and teaches
 * nothing — it reads as a navigation entry that leads nowhere.
 */
export function AvailabilityRefusalNotice({
  refusal,
}: {
  refusal: Extract<SsoSelfServeAvailability, { available: false }>["refusal"];
}) {
  const copy = REFUSAL_COPY[refusal];
  return (
    <Alert.Root status="info" data-testid="sso-availability-refusal">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{copy.title}</Alert.Title>
        <Alert.Description>{copy.body}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/** A refusal from a change, in the words registered for its code. */
export function reportRefusal(error: unknown): void {
  const copy = explainAnyError(error);
  toaster.create({
    title: copy.title,
    description: copy.description,
    type: "error",
    duration: 8000,
  });
}

/**
 * A refusal from a change, ON THE PAGE, beside the control that caused it.
 *
 * A toast is the wrong place for a setup journey's failures. The reader is
 * mid-task, the message is the only thing telling them why the step will not
 * complete, and eight seconds later it is gone with the step still stuck and
 * nothing on screen admitting it. Rendered inline it stays until the next
 * attempt replaces it, which is how somebody debugging a connection actually
 * works.
 *
 * Renders nothing when there is no error, so a call site is one line and
 * never a conditional.
 */
export function InlineRefusal({
  error,
  what,
}: {
  error: unknown;
  /** The act that was refused, named for the title's fallback. */
  what?: string;
}) {
  if (!error) return null;
  const copy = explainAnyError(error);
  return (
    <Alert.Root status="error" data-testid="sso-inline-refusal">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{what ? `${what} didn't work` : copy.title}</Alert.Title>
        <Alert.Description>{copy.description}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
