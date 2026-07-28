import { HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Link } from "../ui/link";

/**
 * LearningResources
 * A quiet footer row of pointers out of the product: documentation and video
 * tutorials. Deliberately whisper-weight — the home page is for the returning
 * user's own data, and docs belong in a footer, not in banner-sized cards
 * competing with it (spec: specs/home/learning-resources.feature). The demo
 * ask lives in the page header, not here. `trailing` hosts dev-only chrome
 * (the briefing mock switcher) at the footer's far end.
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
        <ColophonText>LangWatch © {new Date().getFullYear()}</ColophonText>
        <ColophonDot />
        <ColophonLink href="https://docs.langwatch.ai/integration/python/guide">
          Python SDK
        </ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://docs.langwatch.ai/integration/typescript/guide">
          TypeScript SDK
        </ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://docs.langwatch.ai/integration/go/guide">
          Go SDK
        </ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://scenario.langwatch.ai">
          Scenario
        </ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://docs.langwatch.ai/integration/rest-api">
          REST API
        </ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://github.com/langwatch/langwatch">
          GitHub
        </ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://status.langwatch.ai">Status</ColophonLink>
        <ColophonDot />
        <ColophonLink href="https://langwatch.ai/legal">Legal</ColophonLink>
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

function ColophonLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
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
