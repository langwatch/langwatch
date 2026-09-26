import { Button, Text } from "@chakra-ui/react";
import { AuthCard } from "~/components/auth/AuthCard";
import { Link } from "~/components/ui/link";
import { AuthShell, IdentifierFirstSignIn } from "~/features/auth";
import { AUTH_PRIMARY_STYLE } from "~/features/auth/components/AuthPrimaryButton";
import { useSearchParams } from "~/utils/compat/next-navigation";

/**
 * The sign-in screen (ADR-117).
 *
 * There is one. The identifier-first screen used to sit behind a branch, with
 * a credential form on the other side of it for deployments that had not
 * flipped; both the branch and that form are gone. What routes a person to a
 * password, a passkey or their organization's provider is the router, asked
 * after they say who they are.
 */
export default function SignIn() {
  const signedOut = useSearchParams()?.get("signedOut") === "1";
  return (
    // The same room as sign-up, same seats: words on the left, card on the
    // right. The panel greets rather than pitches, because somebody logging
    // in already made the decision the sign-up headline argues for.
    <AuthShell
      headline={"Let's see what your agents\nhave been up to."}
      headlineAccent="up to"
      tagline="Log in and pick up where you left off."
    >
      {signedOut ? (
        <AuthCard title="You’re signed out" solid>
          <Text textAlign="center">You’ve signed out of LangWatch.</Text>
          <Button {...AUTH_PRIMARY_STYLE} asChild>
            <Link href="/auth/signin">Log in again</Link>
          </Button>
        </AuthCard>
      ) : (
        <IdentifierFirstSignIn />
      )}
    </AuthShell>
  );
}
