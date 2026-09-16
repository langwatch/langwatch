import { Box } from "@chakra-ui/react";
import type { SignInMethod } from "@langwatch/identity-contract";
import { Fingerprint, KeyRound, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { GitHub } from "./github-icon.tsx";
import { Google } from "./google-icon.tsx";
import { Microsoft } from "./microsoft-icon.tsx";

/**
 * The mark on a method's button. A recognized provider gets its own — what
 * someone scanning the screen looks for. Everything else gets the same
 * neutral key: a guessed logo is worse than none.
 */
const BRAND_ICONS: Record<string, ReactNode> = {
  google: <Google />,
  github: <GitHub size={18} />,
  "azure-ad": <Microsoft />,
  microsoft: <Microsoft />,
};

export function SignInMethodIcon({ method }: { method: SignInMethod }) {
  if (method.kind === "password") return <Mail size={18} />;
  if (method.kind === "passkey") return <Fingerprint size={18} />;

  const brand = BRAND_ICONS[method.id];
  if (!brand) return <KeyRound size={18} />;

  return (
    <Box width="18px" height="18px" display="flex" alignItems="center">
      {brand}
    </Box>
  );
}
