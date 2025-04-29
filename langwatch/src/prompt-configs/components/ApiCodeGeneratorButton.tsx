import { useEffect, useState } from "react";
import { Button, Box, useDisclosure, Text, IconButton } from "@chakra-ui/react";
import { Code as CodeIcon, Copy, Check } from "react-feather";
import type { LlmPromptConfig } from "@prisma/client";
import { Dialog } from "~/components/ui/dialog";
import { Tabs } from "~/components/ui/tabs";
import { Tooltip } from "~/components/ui/tooltip";
import { HTTPSnippet } from "httpsnippet";
import { generateSpecs } from "hono-openapi";
import { app } from "~/app/api/prompts/[[...route]]/app";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

interface ValueChangeDetails {
  value: string;
}

interface PromptConfigApiCodeGeneratorProps {
  configId: string;
}

/**
 * Hook to generate code snippets for API calls
 * @param promptConfig The prompt configuration to generate code for
 * @returns Object containing generated code snippets and related functions
 */
export const usePromptConfigApiCodeGenerator = ({
  configId,
}: PromptConfigApiCodeGeneratorProps) => {
  const [activeLanguage, setActiveLanguage] = useState<string>("javascript");
  const projectId = useOrganizationTeamProject().project?.id ?? "";
  const { data: promptConfig } =
    api.llmConfigs.getByIdWithLatestVersion.useQuery({
      id: configId,
      projectId,
    });

  // Generate the HTTP request object for httpsnippet
  const generateRequestObject = () => {
    if (!promptConfig) return null;

    return {
      method: "POST",
      url: `${window.location.origin}/api/prompts/${promptConfig.id}`,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer YOUR_API_KEY",
      },
      postData: {
        mimeType: "application/json",
        text: JSON.stringify(
          {
            // Add any variables the prompt might need
            variables: {},
          },
          null,
          2
        ),
      },
    };
  };

  // Generate code snippets for different languages
  const generateCodeSnippets = () => {
    const requestObj = generateRequestObject();
    if (!requestObj) return {};

    const snippet = new HTTPSnippet(requestObj);

    return {
      javascript: snippet.convert("javascript", "fetch"),
      python: snippet.convert("python", "requests"),
      curl: snippet.convert("shell", "curl"),
      node: snippet.convert("node", "axios"),
    };
  };

  const codeSnippets = promptConfig ? generateCodeSnippets() : {};

  return {
    activeLanguage,
    setActiveLanguage,
    codeSnippets,
  };
};

/**
 * Code snippet display component
 * @param props Component properties
 * @returns React component
 */
export const CodeSnippet = ({
  code,
  language,
}: {
  code: string;
  language: string;
}) => {
  const [hasCopied, setHasCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <Box position="relative" mt={2}>
      <Box
        bg="gray.800"
        color="white"
        p={4}
        borderRadius="md"
        overflowX="auto"
        fontSize="sm"
        fontFamily="mono"
      >
        <pre>{code}</pre>
      </Box>
      <Tooltip
        content={hasCopied ? "Copied!" : "Copy to clipboard"}
        positioning={{ placement: "top" }}
        showArrow
      >
        <IconButton
          aria-label="Copy code"
          size="sm"
          position="absolute"
          top={2}
          right={2}
          onClick={handleCopy}
          colorPalette={hasCopied ? "green" : "gray"}
        >
          {hasCopied ? <Check size={16} /> : <Copy size={16} />}
        </IconButton>
      </Tooltip>
    </Box>
  );
};

/**
 * Modal component for displaying API code examples
 * @param props Component properties
 * @returns React component
 */
export const ApiCodeModal = ({
  open,
  onOpenChange,
  promptConfig,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptConfig?: LlmPromptConfig;
}) => {
  const { activeLanguage, setActiveLanguage, codeSnippets } =
    useCodeGenerator(promptConfig);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => onOpenChange(open)}
      size="xl"
    >
      <Dialog.Content>
        <Dialog.Header>API Code Examples</Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body>
          {promptConfig ? (
            <>
              <Text mb={4}>
                Use the following code to call the "{promptConfig.name}" prompt
                via API:
              </Text>
              <Tabs.Root
                value={activeLanguage}
                onValueChange={(details: ValueChangeDetails) =>
                  setActiveLanguage(details.value)
                }
              >
                <Tabs.List>
                  {Object.keys(codeSnippets).map((lang) => (
                    <Tabs.Trigger key={lang} value={lang}>
                      {lang}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
                <Tabs.Content value={activeLanguage}>
                  {Object.entries(codeSnippets).map(
                    ([lang, code]) =>
                      lang === activeLanguage && (
                        <CodeSnippet key={lang} code={code} language={lang} />
                      )
                  )}
                </Tabs.Content>
              </Tabs.Root>
            </>
          ) : (
            <Text>No prompt configuration selected.</Text>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            colorPalette="blue"
            mr={3}
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};

/**
 * Button component that opens the API code generator modal
 * @param props Component properties
 * @returns React component
 */
export const ApiCodeGeneratorButton = ({
  promptConfig,
}: {
  promptConfig?: LlmPromptConfig;
}) => {
  const { open, onOpen, setOpen } = useDisclosure();

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={onOpen}
        disabled={!promptConfig}
      >
        <CodeIcon size={16} /> API Code
      </Button>
      <ApiCodeModal
        open={open}
        onOpenChange={setOpen}
        promptConfig={promptConfig}
      />
    </>
  );
};
