import { Link } from "@langwatch/browser-host/link";
import { Button, Text } from "@langwatch/design-system/primitives";

import { useSearchParams } from "../../behavior/use-route.ts";
import { AuthCard } from "../elements/auth-card.tsx";
import { FrontDoorShell } from "./front-door-shell.tsx";
import { IdentifierFirstSignIn } from "./identifier-first-sign-in.tsx";

/**
 * The sign-in screen (ADR-117). There is one: the router, asked after somebody
 * says who they are, routes them to a password, a passkey or their provider.
 */
export default function SignIn() {
  const signedOut = useSearchParams()?.get("signedOut") === "1";
  return (
    // The same room as sign-up, same seats: words on the left, card on the
    // right. The panel greets rather than pitches.
    <FrontDoorShell
      headline={"Let's see what your agents\nhave been up to."}
      headlineAccent="up to"
      tagline="Log in and pick up where you left off."
    >
      {signedOut ? (
        <AuthCard title="You’re signed out">
          <Text textAlign="center">You’ve signed out of LangWatch.</Text>
          <Button colorPalette="orange" asChild>
            <Link href="/auth/signin">Log in again</Link>
          </Button>
        </AuthCard>
      ) : (
        <IdentifierFirstSignIn />
      )}
    </FrontDoorShell>
  );
}
