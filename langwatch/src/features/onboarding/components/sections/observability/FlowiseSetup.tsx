import React from "react";
import { VStack, Text, Separator, Card } from "@chakra-ui/react";

/**
 * FlowiseSetup Component
 *
 * Single Responsibility: Provides step-by-step instructions for integrating LangWatch with Flowise
 */
export function FlowiseSetup(): React.ReactElement {

  return (
    <VStack align="stretch" gap={6} minW={0} w="full">
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Flowise Integration
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Enable LangWatch from the Flowise UI for analytics, evaluations and much more
        </Text>
      </VStack>

      <VStack align="stretch" gap={5}>
        <VStack align="stretch" gap={2}>
          <Text fontWeight="semibold">1. Go to your Chatflow settings</Text>
          <Text fontSize="sm" color="fg.muted">
            At the top right corner of your Chatflow or Agentflow, click <strong>Settings &gt; Configuration</strong>
          </Text>
          <Card.Root overflow="hidden" borderWidth="1px" rounded="lg" bg="bg.subtle" maxW="840px" alignSelf="start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/onboarding/flowise/flowise-1.png"
              alt="Flowise settings"
              style={{ maxWidth: "100%", height: "auto", display: "block", maxHeight: "360px", objectFit: "contain" }}
            />
          </Card.Root>
        </VStack>

        <Separator />

        <VStack align="stretch" gap={2}>
          <Text fontWeight="semibold">2. Go to the Analyse Chatflow tab</Text>
          <Text fontSize="sm" color="fg.muted">
            Navigate to the <strong>Analyse Chatflow</strong> tab to find the LangWatch integration option
          </Text>
          <Card.Root overflow="hidden" borderWidth="1px" rounded="lg" bg="bg.subtle" maxW="840px" alignSelf="start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/onboarding/flowise/flowise-2.png"
              alt="Flowise Analyse Chatflow tab"
              style={{ maxWidth: "100%", height: "auto", display: "block", maxHeight: "360px", objectFit: "contain" }}
            />
          </Card.Root>
        </VStack>

        <Separator />

        <VStack align="stretch" gap={2}>
          <Text fontWeight="semibold">3. Create a new credential and enable LangWatch</Text>
          <Text fontSize="sm" color="fg.muted">
            Add your API key to create the LangWatch credential and enable the integration
          </Text>
          <Card.Root overflow="hidden" borderWidth="1px" rounded="lg" bg="bg.subtle" maxW="840px" alignSelf="start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/onboarding/flowise/flowise-3.png"
              alt="Flowise add integration credential"
              style={{ maxWidth: "100%", height: "auto", display: "block", maxHeight: "360px", objectFit: "contain" }}
            />
          </Card.Root>
        </VStack>

        <Separator />

        <VStack align="stretch" gap={2}>
          <Text fontWeight="semibold">4. Test the integration</Text>
          <Text fontSize="sm" color="fg.muted">
            Send a message to your agent or chatflow to see it on LangWatch and start monitoring
          </Text>
        </VStack>
      </VStack>
    </VStack>
  );
}

