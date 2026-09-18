import "../../model/ambient.d.ts";
import { Text } from "@chakra-ui/react";

import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { LEGAL_LINKS } from "../../model/legal-links.ts";

import "../elements/auth-front-door.css";

/**
 * The small print both doors carry, said once. Links go to the site's own
 * legal pages, so the words a person agrees to live in one place. Hosted
 * only: a self-hosted install answers to that company's own terms, which we can't link to.
 */
export function FrontDoorFinePrint() {
  const publicEnv = usePublicEnv();
  if (publicEnv.data?.IS_SAAS !== true) return null;

  return (
    <Text fontSize="11.5px" lineHeight="1.6" color="fg.muted">
      By continuing, you agree to our{" "}
      <FinePrintLink href={LEGAL_LINKS.terms.href}>{LEGAL_LINKS.terms.label}</FinePrintLink> and{" "}
      <FinePrintLink href={LEGAL_LINKS.privacy.href}>{LEGAL_LINKS.privacy.label}</FinePrintLink>.
    </Text>
  );
}

function FinePrintLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        textDecoration: "underline",
        textUnderlineOffset: "2px",
      }}
    >
      {children}
    </a>
  );
}
