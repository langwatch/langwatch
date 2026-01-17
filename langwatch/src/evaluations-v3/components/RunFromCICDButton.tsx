/**
 * RunFromCICDButton - Opens modal with code snippets for CI/CD execution
 *
 * Shows a button that opens a dialog with Python, TypeScript, and curl snippets
 * for running the evaluation from CI/CD pipelines.
 */
import {
  Button,
  HStack,
  Link,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { PrismLanguage } from "@react-email/components";
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLink,
  Terminal,
} from "lucide-react";
import NextLink from "next/link";
import React, { useMemo, useState } from "react";
import { RenderCode } from "~/components/code/RenderCode";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { useEvaluationsV3Store } from "~/evaluations-v3/hooks/useEvaluationsV3Store";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

type Language = "python" | "typescript" | "curl";

type RunFromCICDButtonProps = {
  disabled?: boolean;
};

export function RunFromCICDButton({
  disabled = false,
}: RunFromCICDButtonProps) {
  const { open, onOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const [selectedLanguage, setSelectedLanguage] = useState<Language>("python");

  const { experimentSlug } = useEvaluationsV3Store((state) => ({
    experimentSlug: state.experimentSlug,
  }));

  const snippets = useMemo(() => {
    if (!experimentSlug) return null;

    const baseUrl =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://app.langwatch.ai";

    return {
      python: generatePythonSnippet(experimentSlug),
      typescript: generateTypeScriptSnippet(experimentSlug),
      curl: generateCurlSnippet(experimentSlug, baseUrl),
    };
  }, [experimentSlug]);

  // Don't show if no project or experimentSlug
  if (!project || !experimentSlug) return null;

  const languageConfig: Record<
    Language,
    { label: string; prism: PrismLanguage }
  > = {
    python: { label: "Python", prism: "python" },
    typescript: { label: "TypeScript", prism: "typescript" },
    curl: { label: "curl", prism: "bash" },
  };

  return (
    <>
      <Tooltip
        content="Run from CI/CD"
        showArrow
        positioning={{ placement: "bottom" }}
      >
        <Button
          size="xs"
          variant="ghost"
          onClick={onOpen}
          disabled={disabled}
          aria-label="Run from CI/CD"
        >
          <Terminal size={14} />
          CI/CD
        </Button>
      </Tooltip>

      <Dialog.Root
        open={open}
        onOpenChange={({ open }) => (open ? onOpen() : onClose())}
        size="xl"
      >
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header width="100%" marginTop={4}>
            <VStack alignItems="flex-start" gap={2} width="100%">
              <Dialog.Title>Run from CI/CD</Dialog.Title>
              <Dialog.Description>
                Execute this evaluation from your CI/CD pipeline using one of
                the following code snippets.
              </Dialog.Description>
            </VStack>
          </Dialog.Header>
          <Dialog.Body>
            <VStack align="stretch" gap={4}>
              <HStack justify="flex-start">
                <LanguageMenu
                  selectedLanguage={selectedLanguage}
                  setSelectedLanguage={setSelectedLanguage}
                  languageConfig={languageConfig}
                />
              </HStack>
              {snippets && (
                <RenderCode
                  code={snippets[selectedLanguage]}
                  language={languageConfig[selectedLanguage].prism}
                  style={{
                    fontSize: "12px",
                    lineHeight: "1.5",
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    padding: "20px",
                    borderRadius: "5px",
                  }}
                />
              )}
              <VStack align="flex-start" gap={2}>
                <Text fontSize="sm" color="gray.500">
                  Set the <code>LANGWATCH_API_KEY</code> environment variable
                  with your API key.{" "}
                  <Link asChild color="blue.500">
                    <NextLink href={`/${project.slug}/setup`}>
                      Find your API key{" "}
                      <ExternalLink
                        size={12}
                        style={{ display: "inline", marginLeft: "2px" }}
                      />
                    </NextLink>
                  </Link>
                </Text>
                <Text fontSize="sm" color="gray.500">
                  Learn more about running evaluations from CI/CD in our{" "}
                  <Link
                    href="https://docs.langwatch.ai/llm-evaluation/offline/platform/ci-cd-execution"
                    target="_blank"
                    rel="noopener noreferrer"
                    color="blue.500"
                  >
                    documentation{" "}
                    <ExternalLink
                      size={12}
                      style={{ display: "inline", marginLeft: "2px" }}
                    />
                  </Link>
                </Text>
              </VStack>
            </VStack>
          </Dialog.Body>
          <Dialog.Footer />
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

const LanguageMenu = React.memo(function LanguageMenu({
  selectedLanguage,
  setSelectedLanguage,
  languageConfig,
}: {
  selectedLanguage: Language;
  setSelectedLanguage: (language: Language) => void;
  languageConfig: Record<Language, { label: string; prism: PrismLanguage }>;
}) {
  const { open, onOpen, onClose } = useDisclosure();
  const languages: Language[] = ["python", "typescript", "curl"];

  return (
    <Menu.Root
      open={open}
      onOpenChange={({ open }) => (open ? onOpen() : onClose())}
    >
      <Menu.Trigger asChild>
        <Button aria-label="Select language" size="sm" variant="outline">
          {languageConfig[selectedLanguage].label}
          <ChevronDownIcon />
        </Button>
      </Menu.Trigger>
      <Menu.Content zIndex="popover">
        {languages.map((lang) => (
          <Menu.Item
            key={lang}
            value={lang}
            onClick={() => setSelectedLanguage(lang)}
          >
            {languageConfig[lang].label}
            {selectedLanguage === lang && <CheckIcon />}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
});

// =============================================================================
// Code Snippet Generators
// =============================================================================

const generatePythonSnippet = (slug: string): string => {
  return `import langwatch

result = langwatch.evaluation.evaluate("${slug}")
result.print_summary()`;
};

const generateTypeScriptSnippet = (slug: string): string => {
  return `import { LangWatch } from "langwatch";

const langwatch = new LangWatch();

const result = await langwatch.evaluation.run("${slug}");
result.printSummary();`;
};

const generateCurlSnippet = (slug: string, baseUrl: string): string => {
  return `# Start the evaluation run
RUN_RESPONSE=$(curl -s -X POST "${baseUrl}/api/evaluations/v3/${slug}/run" \\
  -H "X-Auth-Token: \${LANGWATCH_API_KEY}")

RUN_ID=$(echo $RUN_RESPONSE | jq -r '.runId')
echo "Started run: $RUN_ID"

# Poll for completion
while true; do
  STATUS_RESPONSE=$(curl -s "${baseUrl}/api/evaluations/v3/runs/$RUN_ID" \\
    -H "X-Auth-Token: \${LANGWATCH_API_KEY}")

  STATUS=$(echo $STATUS_RESPONSE | jq -r '.status')
  PROGRESS=$(echo $STATUS_RESPONSE | jq -r '.progress')
  TOTAL=$(echo $STATUS_RESPONSE | jq -r '.total')

  echo "Progress: $PROGRESS/$TOTAL"

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi

  sleep 2
done

# Show results
echo $STATUS_RESPONSE | jq '.summary'

# Exit with error if failed
if [ "$STATUS" = "failed" ]; then
  exit 1
fi`;
};
