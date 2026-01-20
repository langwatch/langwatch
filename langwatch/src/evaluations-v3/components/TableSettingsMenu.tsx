/**
 * TableSettingsMenu - Popover menu for table settings
 *
 * Contains:
 * - Row height toggle (compact/expanded)
 * - Run in CI/CD option
 */
import {
  Box,
  Button,
  HStack,
  IconButton,
  Input,
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
  ListChevronsDownUp,
  ListChevronsUpDown,
  SlidersHorizontal,
  Terminal,
} from "lucide-react";
import NextLink from "next/link";
import React, { useMemo, useState } from "react";
import { LuGauge } from "react-icons/lu";
import { RenderCode } from "~/components/code/RenderCode";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { Popover } from "~/components/ui/popover";
import { SimpleSlider } from "~/components/ui/slider";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { RowHeightMode } from "../types";
import { DEFAULT_CONCURRENCY } from "../types";

type ToggleOption = {
  value: RowHeightMode;
  label: string;
  icon: React.ReactNode;
};

const rowHeightOptions: ToggleOption[] = [
  {
    value: "compact",
    label: "Compact",
    icon: <ListChevronsDownUp size={18} />,
  },
  {
    value: "expanded",
    label: "Expanded",
    icon: <ListChevronsUpDown size={18} />,
  },
];

// =============================================================================
// Concurrency Popover Component
// =============================================================================

type ConcurrencyPopoverProps = {
  value: number;
  onChange: (value: number) => void;
};

const ConcurrencyPopover = React.memo(function ConcurrencyPopover({
  value,
  onChange,
}: ConcurrencyPopoverProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value.toString());

  // Sync input when value changes externally
  React.useEffect(() => {
    setInputValue(value.toString());
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    const parsed = parseInt(inputValue, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 24) {
      onChange(parsed);
    } else {
      setInputValue(value.toString());
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleInputBlur();
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      positioning={{ placement: "bottom-end" }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          size="xs"
          justifyContent="space-between"
          paddingX={3}
          paddingY={2}
          height="auto"
          fontSize="13px"
          fontWeight="normal"
          width="100%"
          _hover={{ bg: "gray.100" }}
        >
          <HStack gap={2} color="gray.500" fontWeight="600">
            <LuGauge />
            <Text>Concurrency</Text>
          </HStack>
          <Text>{value}</Text>
        </Button>
      </Popover.Trigger>
      <Popover.Content width="220px" padding={3}>
        <VStack align="stretch" gap={3}>
          <HStack gap={3}>
            <Input
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              size="sm"
              width="50px"
              textAlign="center"
              paddingX={1}
            />
            <SimpleSlider
              value={[value]}
              onValueChange={({ value: newValue }) => {
                const v = newValue[0] ?? DEFAULT_CONCURRENCY;
                onChange(v);
                setInputValue(v.toString());
              }}
              min={1}
              max={24}
              step={1}
              size="sm"
              flex={1}
            />
          </HStack>
          <Text fontSize="11px" color="gray.500">
            Higher values run more cells in parallel but may cause rate limiting
          </Text>
        </VStack>
      </Popover.Content>
    </Popover.Root>
  );
});

// =============================================================================
// Main Component
// =============================================================================

type TableSettingsMenuProps = {
  disabled?: boolean;
};

/**
 * Popover menu containing table settings and actions.
 */
export function TableSettingsMenu({
  disabled = false,
}: TableSettingsMenuProps) {
  const {
    rowHeightMode,
    setRowHeightMode,
    concurrency,
    setConcurrency,
    experimentSlug,
  } = useEvaluationsV3Store((state) => ({
    rowHeightMode: state.ui.rowHeightMode,
    setRowHeightMode: state.setRowHeightMode,
    concurrency: state.ui.concurrency,
    setConcurrency: state.setConcurrency,
    experimentSlug: state.experimentSlug,
  }));

  const { project } = useOrganizationTeamProject();
  const cicdDialog = useDisclosure();
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  // Show CI/CD option only if we have an experiment slug
  const showCICDOption = !!project && !!experimentSlug;

  const handleOpenCICDDialog = () => {
    setPopoverOpen(false); // Close popover first
    cicdDialog.onOpen();
  };

  return (
    <>
      <Popover.Root
        open={popoverOpen}
        onOpenChange={(e) => setPopoverOpen(e.open)}
      >
        <Tooltip
          content="Workbench settings"
          positioning={{ placement: "bottom" }}
          openDelay={100}
        >
          {/* The additional Box element is here to fix the tooltip: https://github.com/chakra-ui/chakra-ui/issues/2843 */}
          <Box display="inline-block">
            <Popover.Trigger asChild>
              <IconButton
                variant="ghost"
                size="sm"
                color="gray.500"
                _hover={{ color: "gray.700", bg: "gray.100" }}
                disabled={disabled}
                aria-label="Workbench settings"
              >
                <SlidersHorizontal size={18} />
              </IconButton>
            </Popover.Trigger>
          </Box>
        </Tooltip>
        <Popover.Content width="auto" padding={3}>
          <VStack align="stretch" gap={3}>
            {/* Row Height Section */}
            <VStack align="stretch" gap={2}>
              <Text fontSize="xs" fontWeight="medium" color="gray.500">
                Row height
              </Text>
              <HStack gap={2}>
                {rowHeightOptions.map((option) => {
                  const isActive = rowHeightMode === option.value;
                  return (
                    <Button
                      key={option.value}
                      variant={isActive ? "surface" : "ghost"}
                      onClick={() => setRowHeightMode(option.value)}
                      display="flex"
                      flexDirection="column"
                      alignItems="center"
                      gap={1.5}
                      paddingX={4}
                      paddingY={3}
                      height="auto"
                      minWidth="80px"
                      fontSize="12px"
                    >
                      {option.icon}
                      <Text>{option.label}</Text>
                    </Button>
                  );
                })}
              </HStack>
            </VStack>

            {/* Concurrency Section */}
            <Box borderTopWidth="1px" borderColor="gray.200" />
            <Text fontSize="xs" fontWeight="medium" color="gray.500">
              Concurrency
            </Text>
            <VStack align="stretch" gap={1}>
              <ConcurrencyPopover
                value={concurrency}
                onChange={setConcurrency}
              />
            </VStack>

            {/* CI/CD Section */}
            {showCICDOption && (
              <>
                <Box borderTopWidth="1px" borderColor="gray.200" />
                <VStack align="stretch" gap={1}>
                  <Text fontSize="xs" fontWeight="medium" color="gray.500">
                    Automation
                  </Text>
                  <Button
                    variant="outline"
                    justifyContent="flex-start"
                    paddingX={3}
                    paddingY={2}
                    height="auto"
                    fontSize="13px"
                    fontWeight="normal"
                    onClick={handleOpenCICDDialog}
                    _hover={{ bg: "gray.100" }}
                  >
                    <HStack gap={2}>
                      <Terminal size={16} />
                      <VStack align="flex-start" gap={0}>
                        <Text>Run in CI/CD</Text>
                        <Text fontSize="11px" color="gray.500">
                          Execute from your pipeline
                        </Text>
                      </VStack>
                    </HStack>
                  </Button>
                </VStack>
              </>
            )}
          </VStack>
        </Popover.Content>
      </Popover.Root>

      {/* CI/CD Dialog */}
      {showCICDOption && (
        <CICDDialog
          open={cicdDialog.open}
          onClose={cicdDialog.onClose}
          experimentSlug={experimentSlug}
          projectSlug={project.slug}
        />
      )}
    </>
  );
}

// =============================================================================
// CI/CD Dialog Component
// =============================================================================

type Language = "python" | "typescript" | "curl";

type CICDDialogProps = {
  open: boolean;
  onClose: () => void;
  experimentSlug: string;
  projectSlug: string;
};

const CICDDialog = React.memo(function CICDDialog({
  open,
  onClose,
  experimentSlug,
  projectSlug,
}: CICDDialogProps) {
  const [selectedLanguage, setSelectedLanguage] = useState<Language>("python");

  const snippets = useMemo(() => {
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

  const languageConfig: Record<
    Language,
    { label: string; prism: PrismLanguage }
  > = {
    python: { label: "Python", prism: "python" },
    typescript: { label: "TypeScript", prism: "typescript" },
    curl: { label: "curl", prism: "bash" },
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: isOpen }) => !isOpen && onClose()}
      size="xl"
    >
      <Dialog.Content>
        <Dialog.CloseTrigger />
        <Dialog.Header width="100%" marginTop={4}>
          <VStack alignItems="flex-start" gap={2} width="100%">
            <Dialog.Title>Run in CI/CD</Dialog.Title>
            <Dialog.Description>
              Execute this evaluation from your CI/CD pipeline using one of the
              following code snippets.
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
            <VStack align="flex-start" gap={2}>
              <Text fontSize="sm" color="gray.500">
                Set the <code>LANGWATCH_API_KEY</code> environment variable with
                your API key.{" "}
                <Link asChild color="blue.500">
                  <NextLink href={`/${projectSlug}/setup`}>
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
  );
});

// =============================================================================
// Language Menu Component
// =============================================================================

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
      onOpenChange={({ open: isOpen }) => (isOpen ? onOpen() : onClose())}
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

result = langwatch.evaluation.run("${slug}")
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
