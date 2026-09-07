import { Box } from "@chakra-ui/react";
import type { SignInMethod } from "@langwatch/identity";
import { Fingerprint, KeyRound, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { SiAuth0, SiKeycloak, SiOkta } from "react-icons/si";
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
 *
 * THE ENTERPRISE PROVIDERS BELONG HERE TOO. These are ids a customer's own
 * connection is registered under, and an administrator who set one up
 * recognizes their vendor's mark faster than the word beside it — the same
 * argument the setup screen's tiles already make. They are drawn from the same
 * icon set as those tiles (`singleSignOn/identityProviders.ts`), so a provider
 * cannot wear one mark while it is being connected and another once it is.
 * The list stays in step with `methodLabels.ts`, which names them.
 */
const BRAND_ICONS: Record<string, ReactNode> = {
  google: <Google />,
  github: <GitHub size={18} />,
  "azure-ad": <Microsoft />,
  microsoft: <Microsoft />,
  okta: <SiOkta size={18} />,
  auth0: <SiAuth0 size={18} />,
  keycloak: <SiKeycloak size={18} />,
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
