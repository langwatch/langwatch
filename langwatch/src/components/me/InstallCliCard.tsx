import {
  Box,
  Button,
  Code,
  Heading,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";

import { Link } from "~/components/ui/link";
import { usePublicEnv } from "~/hooks/usePublicEnv";

/**
 * Empty-state install affordance for the LangWatch CLI.
 *
 * Renders a copy-pasteable `npm install -g langwatch && langwatch login`
 * snippet on cloud, and a `LANGWATCH_ENDPOINT=<host> npm install -g …`
 * variant on self-hosted (auto-detects via `usePublicEnv().BASE_HOST`).
 *
 * Drop into any zero-content surface — /me empty-state, /me/sessions
 * empty-state, governance setup checklist — instead of a bare "Run
 * `langwatch login` in your terminal" sentence that assumes the user
 * already has the CLI installed.
 *
 * Pairs with:
 *   - docs/integration/install.mdx (canonical install guide)
 *   - docs/integration/cli.mdx (post-install login flow)
 *   - typescript-sdk/src/cli (CLI itself)
 *
 * Spec: specs/ai-governance/cli-onboarding/install-cli-card.feature
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
}: {
  heading?: string;
  subline?: string;
} = {}) {
  const publicEnv = usePublicEnv();
  const isSaas = Boolean(publicEnv.data?.IS_SAAS);
  const baseHost = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";

  // On SaaS, the CLI's hardcoded default already points at app.langwatch.ai
  // — no env override needed. On self-hosted, prepend the LANGWATCH_ENDPOINT
  // env so the very first `langwatch login` targets the right control plane.
  // (Once Andre's `--endpoint` flag lands, we can pivot to
  // `langwatch login --endpoint <host>` for cleaner copy-paste; both
  // achieve the same end-state today via env override.)
  const installCommand = isSaas
    ? "npm install -g langwatch"
    : `LANGWATCH_ENDPOINT=${baseHost} npm install -g langwatch`;

  const loginCommand = isSaas
    ? "langwatch login"
    : `LANGWATCH_ENDPOINT=${baseHost} langwatch login`;

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={5}
      backgroundColor="bg.subtle"
      width="full"
    >
      <VStack align="stretch" gap={4}>
        <HStack gap={2}>
          <Box color="fg.muted">
            <Terminal size={18} />
          </Box>
          <Heading as="h3" size="sm">
            {heading}
          </Heading>
        </HStack>
        <Text fontSize="sm" color="fg.muted">
          {subline}
        </Text>

        <CommandRow
          label="1. Install"
          command={installCommand}
          ariaLabel="Copy install command"
        />
        <CommandRow
          label="2. Authenticate"
          command={loginCommand}
          ariaLabel="Copy login command"
        />

        {!isSaas && (
          <Text fontSize="xs" color="fg.muted">
            Self-hosted detected — commands target{" "}
            <Code fontSize="xs">{baseHost}</Code>. The endpoint is persisted
            after the first login; later commands don&apos;t need the prefix.
          </Text>
        )}

        <HStack gap={2}>
          <Button size="xs" variant="outline" asChild>
            <Link href="/integration/install">Install guide ↗</Link>
          </Button>
          <Button size="xs" variant="ghost" asChild>
            <Link href="/integration/cli">CLI reference ↗</Link>
          </Button>
        </HStack>
      </VStack>
    </Box>
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
      <HStack
        gap={2}
        padding={2}
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="sm"
        backgroundColor="bg"
      >
        <Code
          flex={1}
          backgroundColor="transparent"
          fontSize="sm"
          overflowX="auto"
          whiteSpace="nowrap"
        >
          $ {command}
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
    </VStack>
  );
}
