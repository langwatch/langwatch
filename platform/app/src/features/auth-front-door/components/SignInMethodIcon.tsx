import { Box } from "@chakra-ui/react";
import type { SignInMethod } from "@langwatch/identity-contract";
import { Fingerprint, KeyRound, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { GitHub } from "~/components/icons/GitHub";
import { Google } from "~/components/icons/Google";
import { Microsoft } from "~/components/icons/Microsoft";

/**
 * The mark on a method's button.
 *
 * A provider people recognize gets its own: that mark, not the words beside
 * it, is what someone scanning the screen is actually looking for. Everything
 * else gets the same neutral key, because inventing a logo for a connection we
 * know nothing about would be a worse guess than not drawing one.
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
