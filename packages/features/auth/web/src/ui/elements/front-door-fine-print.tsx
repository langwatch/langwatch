/// <reference path="../../model/ambient.d.ts" />
import { Text } from "@chakra-ui/react";
import { usePublicEnv } from "../../behavior/use-public-env";
import { LEGAL_LINKS } from "../../model/legal-links";
import "./auth-front-door.css";

/**
 * The small print both doors carry: what continuing means, said once, in the
 * quietest voice on the card. The links go to the site's own legal pages, so
 * the words a person agrees to live in exactly one place.
 *
 * Hosted only: the terms are the cloud's terms, and a company's own
 * installation answers to that company's, which we cannot link to.
 */
export function FrontDoorFinePrint() {
  const publicEnv = usePublicEnv();
  if (publicEnv.data?.IS_SAAS !== true) return null;

  return (
    <Text fontSize="11.5px" lineHeight="1.6" color="fg.muted">
      By continuing, you agree to our{" "}
      <FinePrintLink href={LEGAL_LINKS.terms.href}>
        {LEGAL_LINKS.terms.label}
      </FinePrintLink>{" "}
      and{" "}
      <FinePrintLink href={LEGAL_LINKS.privacy.href}>
        {LEGAL_LINKS.privacy.label}
      </FinePrintLink>
      .
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
