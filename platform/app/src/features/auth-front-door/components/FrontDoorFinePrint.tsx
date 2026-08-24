import { Text } from "@chakra-ui/react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import "../authFrontDoor.css";

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
      <FinePrintLink href="https://langwatch.ai/legal/terms-conditions">
        Terms
      </FinePrintLink>{" "}
      and{" "}
      <FinePrintLink href="https://langwatch.ai/legal/privacy-policy">
        Privacy Policy
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
