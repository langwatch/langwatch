import { Box, Code, Flex, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { FeatureIllustration } from "../components/brand/feature-illustration.tsx";
import { FeatureLockup } from "../components/brand/feature-lockup.tsx";
import { FeatureMark } from "../components/brand/feature-mark.tsx";

const ROLES = [
  { token: "feature.braids.lead", role: "Lead strand: the app orange, by reference" },
  { token: "feature.braids.weave", role: "The other strands: slate, off-white on dark" },
  { token: "feature.braids.project.1", role: "First example project in the art" },
  { token: "feature.braids.project.2", role: "Second example project" },
  { token: "feature.braids.project.3", role: "Third example project" },
] as const;

const STEPS = [
  "Earn it: a feature with its own landing page, docs and launch, named in copy.",
  "Put the brand kit in dev/docs/plans/<feature>/brand and get the mark and tagline decided.",
  "Translate the mark into <feature>-paths.ts: path data only, every colour a role.",
  "Add feature.<feature>.* tokens to config.ts, light and dark, and rows in Foundations/Colour.",
  "Register the feature in feature-brands.ts and its art in feature-illustration.tsx.",
  "Add stories and a scenario per part, bound to renderWithDesignSystem tests.",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="4">
      <Heading size="sm">{title}</Heading>
      {children}
    </Stack>
  );
}

function FeatureBranding() {
  return (
    <Stack gap="10" maxWidth="5xl" padding="8" marginX="auto">
      <Stack gap="2">
        <Heading size="xl">How features are branded</Heading>
        <Text color="fg.muted">
          A few features earn their own name, mark and art inside LangWatch. They share one set of
          parts and rules, written up in{" "}
          <Code>packages/design-system/docs/feature-branding.md</Code>. Braids is the worked
          example.
        </Text>
      </Stack>

      <Section title="Lockup">
        <Grid templateColumns="repeat(auto-fit, minmax(18rem, 1fr))" gap="4">
          {(["light", "dark"] as const).map((mode) => (
            <Box
              key={mode}
              className={`chakra-theme ${mode}`}
              bg="bg.panel"
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="lg"
              padding="6"
            >
              <FeatureLockup feature="braids" size="lg" tagline />
            </Box>
          ))}
        </Grid>
      </Section>

      <Section title="Mark: colour, one colour and the small master">
        <Flex gap="8" wrap="wrap" align="end" color="fg">
          <FeatureMark feature="braids" size={56} />
          <FeatureMark feature="braids" size={56} variant="mono" />
          <FeatureMark feature="braids" size={24} />
          <FeatureMark feature="braids" size={16} variant="mono" />
        </Flex>
      </Section>

      <Section title="Colour roles">
        <Grid templateColumns="repeat(auto-fit, minmax(14rem, 1fr))" gap="3">
          {ROLES.map(({ token, role }) => (
            <Flex key={token} gap="3" align="center">
              <Box boxSize="8" borderRadius="md" bg={token} flexShrink={0} />
              <Stack gap="0">
                <Text fontFamily="mono" fontSize="xs">
                  {token}
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  {role}
                </Text>
              </Stack>
            </Flex>
          ))}
        </Grid>
      </Section>

      <Section title="Illustrations">
        <Grid templateColumns="repeat(auto-fit, minmax(22rem, 1fr))" gap="4">
          <FeatureIllustration feature="braids" name="hero" />
          <FeatureIllustration feature="braids" name="empty-state" />
          <FeatureIllustration feature="braids" name="enterprise" />
        </Grid>
      </Section>

      <Section title="Branding the next feature">
        <Stack as="ol" gap="2" paddingStart="5">
          {STEPS.map((step) => (
            <Text as="li" key={step} color="fg">
              {step}
            </Text>
          ))}
        </Stack>
      </Section>
    </Stack>
  );
}

const meta = {
  title: "Brand/Feature branding",
  component: FeatureBranding,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    usage: {
      use: "How a feature earns and wears its own brand, with Braids as the worked example.",
      avoid: "Branding a feature that is a setting or a tab; a second orange.",
    },
  },
} satisfies Meta<typeof FeatureBranding>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
