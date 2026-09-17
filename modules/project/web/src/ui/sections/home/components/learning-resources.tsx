import { HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { nowInstant, toDate } from "@langwatch/time";
import { LEGAL_LINKS } from "../../../../model/legal-links.ts";
import { Link } from "../../../../ui/elements/app-link.tsx";

/**
 * Quiet footer row of documentation and tutorial links; intentionally
 * whisper-weight to not compete with the home's main content.
 */
export function LearningResources({ trailing }: { trailing?: ReactNode }) {
  return (
    <VStack
      width="full"
      align="stretch"
      gap={3}
      paddingTop={4}
      borderTopWidth="1px"
      borderTopColor="border.muted"
    >
      {/* The colophon: a whisper of mono right under the rule — part
          wayfinding, part typography. Docs and videos live in the Odyssey
          card now, so this row is the footer entire. */}
      <HStack gap={2} flexWrap="wrap" fontFamily="mono" fontSize="10.5px">
        <ColophonText>LangWatch © {toDate(nowInstant()).getFullYear()}</ColophonText>
        <ColophonDot />
        <ColophonLink href="https://docs.langwatch.ai/integration/python/guide">
          Python SDK
        </ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://docs.langwatch.ai/integration/typescript/guide">
          TypeScript SDK
        </ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://docs.langwatch.ai/integration/go/guide">Go SDK</ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://scenario.langwatch.ai">Scenario</ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://docs.langwatch.ai/integration/rest-api">REST API</ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://github.com/langwatch/langwatch">GitHub</ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://status.langwatch.ai">Status</ColophonLink>
        <ColophonDot />
        {/* The two documents by name, rather than the index that holds them:
            "Legal" is a category, and nobody is looking for a category. */}
        <ColophonLink href={LEGAL_LINKS.terms.href}>{LEGAL_LINKS.terms.label}</ColophonLink>
        <ColophonDot />
        <ColophonLink href={LEGAL_LINKS.privacy.href}>{LEGAL_LINKS.privacy.label}</ColophonLink>
        <Spacer />
        {trailing}
      </HStack>
    </VStack>
  );
}

function ColophonText({ children }: { children: ReactNode }) {
  return (
    <Text as="span" fontFamily="mono" fontSize="10.5px" color="fg.subtle">
      {children}
    </Text>
  );
}

function ColophonDot() {
  return (
    <Text as="span" color="fg.subtle" aria-hidden>
      ·
    </Text>
  );
}

function ColophonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      isExternal
      fontFamily="mono"
      fontSize="10.5px"
      color="fg.subtle"
      _hover={{ color: "orange.500" }}
    >
      {children}
    </Link>
  );
}
