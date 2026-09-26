import { Badge, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { BellPlus, Plus } from "lucide-react";

import { withGovernanceSection } from "../../../ui/sections/governance-section-gate.tsx";
import { Link } from "../../elements/governance-link.tsx";
import GovernanceLayout from "../governance-layout.tsx";

/**
 * Rule registry placeholder. Nothing creates rules yet. Preview badge, disabled buttons
 * (honest way to offer incomplete controls).
 */
function SignalsPage() {
  return (
    <GovernanceLayout pageTitle="Signals & Alerts · AI Governance · LangWatch">
      <VStack align="stretch" gap={8} width="full">
        <HStack justify="space-between" align="start" gap={6}>
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading size="md">Signals &amp; Alerts</Heading>
              <Badge colorPalette="purple" size="sm" variant="surface">
                Preview
              </Badge>
            </HStack>
            <Text color="fg.muted">
              A preview of where signal rules will live: a condition to watch for, and what happens
              when one fires. Nothing is being watched yet.
            </Text>
          </VStack>
          <HStack gap={2} flexShrink={0}>
            {/* Neither button has handler, both disabled (honest: "not yet built").
                Weighted by page-header rule; New signal takes outline (future create action).
                Copy says rule creation coming. */}
            <Button size="sm" variant="ghost" disabled>
              <BellPlus size={14} />
              New alert
            </Button>
            <PageLayout.HeaderButton disabled>
              <Plus size={14} />
              New signal
            </PageLayout.HeaderButton>
          </HStack>
        </HStack>

        <VStack align="stretch" gap={3}>
          <HStack gap={2} align="baseline" flexWrap="wrap">
            <Text fontWeight="semibold">What this page will hold</Text>
            <Text fontSize="sm" color="fg.muted">
              one registry for the rules that watch your activity. The alerts they raise will be
              listed in the <Link href="/governance/insights">Insights inbox</Link>.
            </Text>
          </HStack>
          <VStack
            data-testid="signals-empty-registry"
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="lg"
            paddingY={14}
            paddingX={6}
          >
            <Text color="fg.muted">No rules here yet. Creating one is coming.</Text>
          </VStack>
        </VStack>

        <Text fontSize="sm" color="fg.muted">
          A signal that uses a model will run on your organization&apos;s{" "}
          <Link href="/settings/model-providers">model providers</Link>.
        </Text>
      </VStack>
    </GovernanceLayout>
  );
}

export default withGovernanceSection(SignalsPage);
