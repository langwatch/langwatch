// Before the project braids into any other: the art, one sentence on what a braid does, the steps.
// Spec: modules/authz/specs/braids-screen.feature, "A project with no braids says what a braid..."

import { Link } from "@langwatch/browser-host/link";
import { Card } from "@langwatch/design-system/card";
import { FeatureIllustration } from "@langwatch/design-system/feature-illustration";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { Box, Grid, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { Copy, ExternalLink, Tag } from "lucide-react";
import type { ReactNode } from "react";

import { BRAIDS_GUIDE_HREF } from "../../../model/braids/braids.ts";

const STEPS: readonly { title: string; icon: ReactNode; body: ReactNode }[] = [
  {
    title: "Tag the call",
    icon: <Tag size={14} aria-hidden />,
    body: (
      <>
        The calling project adds a tag such as{" "}
        <InlineCode variant="neutral">orchestrator=web</InlineCode> to its calls and signs it.
      </>
    ),
  },
  {
    title: "Copy the tag",
    icon: <Copy size={14} aria-hidden />,
    body: "This project's SDK copies the tag onto its spans. One line of setup.",
  },
  {
    title: "Braid",
    icon: <FeatureMark feature="braids" size={14} variant="mono" />,
    body: "Pick the project and a condition. Only spans that match are shown there.",
  },
];

export function BraidsHowItWorks({ projectName }: { projectName: string }) {
  return (
    <Card padding="none" data-testid="braids-empty-into">
      <Box display="flex" justifyContent="center" paddingX={6}>
        <Box width="full" maxWidth="720px">
          <FeatureIllustration feature="braids" name="empty-state" />
        </Box>
      </Box>
      <Stack gap={1} align="center" textAlign="center" paddingX={6} paddingBottom={6}>
        <Text textStyle="md" fontWeight="semibold">
          Not braided into any project
        </Text>
        <Text textStyle="sm" color="fg.muted" maxWidth="60ch">
          A braid shows {projectName}&apos;s matching spans inside another project&apos;s traces, so
          it can follow its calls all the way down.
        </Text>
        <Link
          href={BRAIDS_GUIDE_HREF}
          isExternal
          textStyle="sm"
          color="fg.muted"
          _hover={{ color: "fg" }}
          display="inline-flex"
          alignItems="center"
          gap={1}
          marginTop={2}
        >
          Read the docs
          <ExternalLink size={12} aria-hidden />
        </Link>
      </Stack>
      <Grid
        templateColumns={{ base: "1fr", md: "repeat(3, minmax(0, 1fr))" }}
        borderTopWidth="1px"
        borderColor="border.muted"
        data-testid="braids-steps"
      >
        {STEPS.map((step, index) => (
          <Stack
            key={step.title}
            gap={1}
            paddingX={5}
            paddingY={4}
            borderColor="border.muted"
            borderTopWidth={{ base: index === 0 ? 0 : "1px", md: 0 }}
            borderLeftWidth={{ base: 0, md: index === 0 ? 0 : "1px" }}
          >
            <HStack gap={2}>
              <Box color="fg.muted" display="inline-flex">
                {step.icon}
              </Box>
              <Text textStyle="sm" fontWeight="medium">
                {index + 1}. {step.title}
              </Text>
            </HStack>
            <Text textStyle="sm" color="fg.muted">
              {step.body}
            </Text>
          </Stack>
        ))}
      </Grid>
    </Card>
  );
}
