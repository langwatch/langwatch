import { AuthShell, VerificationFirstSignUp } from "~/features/auth";

/**
 * The sign-up screen (ADR-117).
 *
 * There is one. It asks for an address and confirms it before it asks for
 * anything else, which is what makes the account it creates one somebody can
 * always get back into.
 */
export default function SignUp() {
  return (
    // The pitch is the hosted product's, and it lives OUTSIDE the card: the
    // card itself is the same on every installation.
    //
    // Nothing sits under the tagline. `trustStrip` stayed empty because the
    // one thing that belongs there is a customer — a quote or a logo row —
    // and both are somebody else's decision to be named. A row of INTEGRATION
    // marks was tried in that slot and is the wrong module for this page: it
    // argues we are compatible, when the question a stranger is asking is
    // whether anybody else trusts us. Leave it empty until there is a cleared
    // name to put in it; an empty slot beats furniture.
    <AuthShell
      headline={"See what your agents\nare actually doing."}
      headlineAccent="actually"
      // Names the thing they are seconds away from, rather than listing what
      // the product has. "Traces, evaluations and monitoring" was a feature
      // list read by somebody who has not agreed to want any of them yet.
      tagline="You are a minute away from watching a simulated user push your agent until it breaks. Free to start, no credit card."
    >
      <VerificationFirstSignUp />
    </AuthShell>
  );
}
