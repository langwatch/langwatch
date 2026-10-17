/**
 * The MCP setup card `mcp_setup` puts up: pick the client and the sign-in method, copy this
 * deployment's MCP address, follow the steps. The picks are this card's own state.
 * Spec: specs/langy/langy-mcp-setup.feature
 */
import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import { Link } from "@langwatch/browser-host/link";
import {
  Badge,
  Box,
  Button,
  HStack,
  List,
  Text,
  VStack,
  Wrap,
} from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { ArrowUpRight, Plug } from "lucide-react";
import { type ReactNode, useState } from "react";

import { TYPE } from "../../../../model/asaplangy-tokens.ts";
import { LangyCopyButton } from "../../../../ui/elements/langy-copy-button.tsx";
import { LangyCard } from "../../../../ui/sections/langy-card.tsx";
import {
  LANGWATCH_MCP_DOCS_URL,
  type LangyMcpSetupCall,
  MCP_SETUP_CLIENT_LABELS,
  MCP_SETUP_CLIENTS,
  mcpAuthorizationHeader,
  type McpSetupClient,
  type McpSetupMethod,
  type McpSetupStep,
  mcpServerUrl,
  mcpSetupSteps,
} from "../../model/langy-mcp-setup-tool.ts";

export const LANGY_MCP_OAUTH_WHY =
  "No key to manage: access is tied to you and the project you approve, and it refreshes itself.";
export const LANGY_MCP_API_KEY_WHY =
  "For clients without OAuth sign-in, or headless and CI use. Send a personal API key as a header:";

export function LangyMcpSetupCard({ call }: { call: LangyMcpSetupCall }) {
  const { appBaseUrl } = useUiDeployment();
  const [client, setClient] = useState<McpSetupClient>(call.client ?? "claude");
  const [method, setMethod] = useState<McpSetupMethod>(call.method);
  const url = mcpServerUrl(appBaseUrl);
  const steps = mcpSetupSteps({ client, method, appBaseUrl });

  return (
    <Box data-testid="langy-mcp-setup-card" maxWidth="560px">
      <LangyCard
        intent="ask"
        overline={
          <HStack as="span" gap={1.5} align="center">
            <Plug size={11} aria-hidden="true" />
            <Text as="span">Connect the LangWatch MCP</Text>
          </HStack>
        }
        title="Use LangWatch from your AI client"
        aria-label="Connect the LangWatch MCP"
        actions={
          <Link href={LANGWATCH_MCP_DOCS_URL} isExternal textStyle="xs" color="fg.muted">
            Full guide
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        }
      >
        <VStack align="stretch" gap={3}>
          <Field label="Your client">
            <Wrap gap={1.5}>
              {MCP_SETUP_CLIENTS.map((option) => (
                <Button
                  key={option}
                  size="2xs"
                  variant={option === client ? "solid" : "outline"}
                  aria-pressed={option === client}
                  onClick={() => setClient(option)}
                >
                  {MCP_SETUP_CLIENT_LABELS[option]}
                </Button>
              ))}
            </Wrap>
          </Field>
          <Field label="Server URL">
            <HStack align="center" gap={1}>
              <Snippet text={url} testId="langy-mcp-setup-url" />
              <LangyCopyButton value={url} label="The MCP server URL" />
            </HStack>
          </Field>
          <Field label="Sign in with">
            <SegmentedControl
              size="xs"
              value={method}
              onValueChange={({ value }) => setMethod(value === "api-key" ? "api-key" : "oauth")}
              items={[
                {
                  value: "oauth",
                  label: (
                    <HStack as="span" gap={1.5}>
                      <Text as="span">OAuth</Text>
                      <Badge size="xs" variant="subtle" colorPalette="green">
                        Recommended
                      </Badge>
                    </HStack>
                  ),
                },
                { value: "api-key", label: "API key" },
              ]}
            />
            <MethodWhy method={method} />
          </Field>
          <Steps steps={steps} />
        </VStack>
      </LangyCard>
    </Box>
  );
}

function MethodWhy({ method }: { method: McpSetupMethod }) {
  if (method === "oauth") {
    return (
      <Text textStyle="xs" color="fg.muted">
        {LANGY_MCP_OAUTH_WHY}
      </Text>
    );
  }
  return (
    <VStack align="stretch" gap={1}>
      <Text textStyle="xs" color="fg.muted">
        {LANGY_MCP_API_KEY_WHY}
      </Text>
      <Snippet text={mcpAuthorizationHeader()} testId="langy-mcp-setup-header" />
    </VStack>
  );
}

function Steps({ steps }: { steps: McpSetupStep[] }) {
  return (
    <List.Root as="ol" gap={2} paddingStart={4} textStyle="xs" data-testid="langy-mcp-setup-steps">
      {steps.map((step) => (
        <List.Item key={step.text}>
          <VStack align="stretch" gap={1}>
            <Text textStyle="xs" color="fg">
              {step.text}
              {step.link ? (
                <>
                  {" "}
                  <Link href={step.link.href} textStyle="xs">
                    {step.link.label}
                  </Link>
                </>
              ) : null}
            </Text>
            {step.code ? (
              <HStack align="start" gap={1}>
                <Snippet text={step.code} />
                <LangyCopyButton value={step.code} label="The snippet" />
              </HStack>
            ) : null}
          </VStack>
        </List.Item>
      ))}
    </List.Root>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="stretch" gap={1.5}>
      <Text {...TYPE.sectionLabel}>{label}</Text>
      {children}
    </VStack>
  );
}

function Snippet({ text, testId }: { text: string; testId?: string }) {
  return (
    <Box
      as="pre"
      data-testid={testId}
      flex="1"
      minWidth={0}
      margin={0}
      padding={2}
      borderRadius="sm"
      background="bg.muted"
      color="fg"
      fontFamily="mono"
      textStyle="xs"
      whiteSpace="pre-wrap"
      overflowWrap="anywhere"
    >
      {text}
    </Box>
  );
}
