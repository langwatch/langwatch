import { Card } from "@langwatch/design-system/card";
import {
  Button,
  Code,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { docsUrl } from "@langwatch/handled-error/docs-url";
import { Check, Copy, ExternalLink, Terminal } from "lucide-react";
import { useState } from "react";

import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { Link } from "../elements/personal-link.tsx";

/**
 * Empty-state install affordance for the LangWatch CLI.
 * Renders copy-pasteable install + login snippet (cloud and self-hosted variants).
 */
export function InstallCliCard({
  /**
   * Headline copy. Defaults to "Install the LangWatch CLI"; surfaces
   * may override for context (e.g., "Install the CLI to get started").
   */
  heading = "Install the LangWatch CLI",
  /**
   * Subline copy. Defaults to a generic "one-time setup" line. Andre's
   * unified `langwatch login` flow tree (in flight) may refine; component
   * is intentionally flow-agnostic so it doesn't block on the BDD.
   */
  subline = "One-time setup. After installing, run `langwatch login` to authenticate this device.",
  /**
   * Inside a card that already carries a title: no frame of its own, no
   * heading row, no subline. Only the two commands and the docs links.
   */
  compact = false,
}: {
  heading?: string;
  subline?: string;
  compact?: boolean;
} = {}) {
  const { isSaas, appBaseUrl: baseHost } = usePersonalWorkspaceHost().deployment();

  // On SaaS, the CLI's hardcoded default already points at app.langwatch.ai.
  // On self-hosted, pass the endpoint as a flag on `langwatch login` (the
  // login flow persists it, so later commands don't need the flag).
  const installCommand = "npm install -g langwatch";

  const loginCommand = isSaas ? "langwatch login" : `langwatch login --endpoint ${baseHost}`;

  const steps = (
    <VStack align="stretch" gap={compact ? 3 : 4}>
      <Text fontSize="xs" color="fg.muted">
        Requires Node.js 18 or newer (the <Code fontSize="xs">npm</Code> command ships with it). Get
        it at <Code fontSize="xs">nodejs.org</Code>.
      </Text>

      <CommandRow label="1. Install" command={installCommand} ariaLabel="Copy install command" />
      <CommandRow label="2. Authenticate" command={loginCommand} ariaLabel="Copy login command" />

      {!isSaas && (
        <Text fontSize="xs" color="fg.muted">
          Self-hosted detected. The login flag targets <Code fontSize="xs">{baseHost}</Code>; the
          endpoint is persisted after that first login, so subsequent commands don&apos;t need it.
        </Text>
      )}

      <HStack gap={2}>
        <Button size="xs" variant="outline" asChild>
          <Link href={docsUrl("/integration/cli#install")} isExternal gap={1}>
            Install guide <ExternalLink size={12} />
          </Link>
        </Button>
        <Button size="xs" variant="ghost" asChild>
          <Link href={docsUrl("/integration/cli")} isExternal gap={1}>
            CLI reference <ExternalLink size={12} />
          </Link>
        </Button>
      </HStack>
    </VStack>
  );

  if (compact) return steps;

  return (
    <Card
      variant="elevated"
      padding="lg"
      titleLevel={3}
      icon={<Terminal size={18} />}
      title={heading}
      description={subline}
    >
      {steps}
    </Card>
  );
}

function CommandRow({
  label,
  command,
  ariaLabel,
}: {
  label: string;
  command: string;
  ariaLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        {label}
      </Text>
      <Card variant="nested" padding="sm">
        <HStack gap={2}>
          {/* "$" is a separate, non-selectable, lighter element so copying the
              command by hand never picks up the prompt. */}
          <Text
            as="span"
            fontFamily="mono"
            fontSize="sm"
            color="fg.muted"
            userSelect="none"
            flexShrink={0}
            aria-hidden="true"
          >
            $
          </Text>
          <Code
            flex={1}
            minWidth={0}
            backgroundColor="transparent"
            fontSize="sm"
            overflowX="auto"
            whiteSpace="nowrap"
          >
            {command}
          </Code>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={copied ? "Copied" : ariaLabel}
            onClick={onCopy}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
        </HStack>
      </Card>
    </VStack>
  );
}
