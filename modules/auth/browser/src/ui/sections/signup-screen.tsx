import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { FrontDoorShell } from "./front-door-shell.tsx";
import { VerificationFirstSignUp } from "./verification-first-sign-up.tsx";

/**
 * The sign-up screen (ADR-117 §6). There is one: it confirms the address
 * before it asks for anything else. Only the pitch differs by deployment.
 */
export default function SignUp() {
  const isHosted = usePublicEnv().data?.IS_SAAS === true;

  return (
    <FrontDoorShell
      headline={"See what your agents\nare actually doing."}
      headlineAccent="actually"
      tagline={
        isHosted
          ? "You are a minute away from watching a simulated user push your agent until it breaks. Free to start, no credit card."
          : "Create your account on this installation and pick up where your team is working."
      }
    >
      <VerificationFirstSignUp />
    </FrontDoorShell>
  );
}
