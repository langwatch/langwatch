// Before there are any braids: the empty-state art, what a braid is, and the three steps.
// Spec: modules/authz/specs/braids-screen.feature, "The page explains braids before there are any".

import { Card, CardGrid } from "@langwatch/design-system/card";
import { FeatureIllustration } from "@langwatch/design-system/feature-illustration";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { Box, Heading, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { Copy, Tag } from "lucide-react";
import type { ReactNode } from "react";

export type BraidsHowItWorksProps = {
  /** New braid and the guide link, or nothing for a viewer who may not braid. */
  actions?: ReactNode;
};

export function BraidsHowItWorks({ actions }: BraidsHowItWorksProps) {
  return (
    <Stack gap={4} data-testid="braids-how-it-works">
      <Card padding="none">
        <Box
          borderBottomWidth="1px"
          borderColor="border"
          bg="bg.subtle"
          display="grid"
          placeItems="center"
          css={{ "& > *": { width: "100%", height: "auto", maxWidth: "none" } }}
        >
          <FeatureIllustration feature="braids" name="empty-state" />
        </Box>
        <Stack
          direction={{ base: "column", md: "row" }}
          gap={6}
          padding={6}
          align={{ base: "stretch", md: "flex-end" }}
        >
          <Stack gap={2} flex={1} maxWidth="560px">
            <Heading as="h2" size="md">
              One trace, across every project
            </Heading>
            <Text color="fg.muted">
              When your agents call agents in other projects, the trace stops at the project line. A
              braid shows this project&apos;s matching spans inside the other project&apos;s traces,
              so it sees its calls all the way down. Nothing is copied.
            </Text>
          </Stack>
          {actions ? <HStack gap={2}>{actions}</HStack> : null}
        </Stack>
      </Card>
      <CardGrid columns={3} data-testid="braids-steps">
        <Card
          title="1. Tag the call"
          icon={<Tag size={16} aria-hidden />}
          description={
            <>
              The calling project adds a tag such as <InlineCode>orchestrator=web</InlineCode> to
              its calls and signs it.
            </>
          }
        />
        <Card
          title="2. Copy the tag"
          icon={<Copy size={16} aria-hidden />}
          description="This project's SDK copies the tag onto its spans. One line of setup."
        />
        <Card
          title="3. Braid"
          icon={<FeatureMark feature="braids" size={16} variant="mono" />}
          description="Pick the project and a condition. Only spans that match ever leave this project."
        />
      </CardGrid>
    </Stack>
  );
}
