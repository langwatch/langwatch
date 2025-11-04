import React, { useState } from "react";
import { VStack, Text, Separator, Accordion } from "@chakra-ui/react";
import { CodePreview } from "./CodePreview";
import { useActiveProject } from "../../../contexts/ActiveProjectContext";
import { Link } from "../../../../../components/ui/link";
import { ExternalLink } from "react-feather";

export function LangflowSetup(): React.ReactElement {
  const { project } = useActiveProject();
  const [isVisible, setIsVisible] = useState(false);
  const [accordionValue, setAccordionValue] = useState<string[]>([]);

  const effectiveApiKey = project?.apiKey ?? "";

  function toggleVisibility(): void {
    setIsVisible((prev) => !prev);
  }

  const envVarsCode = `# Add to Langflow .env file:
LANGWATCH_API_KEY="${effectiveApiKey}"

# Or export in your terminal:
export LANGWATCH_API_KEY="${effectiveApiKey}"`;

  const customInputOutputCode = `import langwatch

# Define custom input and output
langwatch.get_current_trace().update(
    input="The user input",
    output="My bot output"
)`;

  const metadataCode = `import langwatch

# Capture additional metadata
langwatch.get_current_trace().update(
    metadata={
        "user_id": self.sender_name,
        "thread_id": self.session_id,
        # any other metadata you want to track
    }
)`;

  const accordionItems = [
    {
      value: "custom-io",
      title: "Defining custom input and output",
      description: "You can customize what LangWatch captures as the final input and output of your Langflow component for better observability.",
      code: customInputOutputCode,
      filename: "component_code.py",
      instructions: [
        'Click on the <> Code button in any appropriate component',
        'Scroll down to find the def responsible for execution of that component',
        'Paste the code above, mapping the variables as needed for your case'
      ]
    },
    {
      value: "metadata",
      title: "Capturing additional metadata",
      description: "You can capture additional metadata from your Langflow component. This can be useful for capturing information about the user, the conversation, or any specific information from your system.",
      code: metadataCode,
      filename: "component_code.py",
      instructions: [
        'Use the same <> Code button access method as above',
        'Add the metadata update call in the execution function',
        'Common fields to capture: user_id, thread_id (groups messages from same conversation)'
      ]
    }
  ];

  return (
    <VStack align="stretch" gap={6} minW={0} w="full">
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Langflow Integration
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Enable LangWatch from Langflow environment variables
        </Text>
      </VStack>

      <VStack align="stretch" gap={3}>
        <Text textStyle="md" fontWeight="semibold">
          Setup
        </Text>
        <Text textStyle="sm">
          Add the following environment variable to your Langflow configuration. This will automatically
          enable LangWatch tracing for all your Langflow components.
        </Text>
        <CodePreview
          code={envVarsCode}
          filename=".env"
          codeLanguage="bash"
          sensitiveValue={effectiveApiKey}
          enableVisibilityToggle={true}
          isVisible={isVisible}
          onToggleVisibility={toggleVisibility}
        />
        <Text textStyle="sm" fontWeight="medium">
          Restart Langflow
        </Text>
        <Text textStyle="sm" color="fg.muted">
          Restart Langflow using:
        </Text>
        <CodePreview
          code="langflow run --env-file .env"
          filename="terminal"
          codeLanguage="bash"
        />
        <Text textStyle="sm" color="fg.muted">
          Run a message through your Langflow project and check the LangWatch dashboard for monitoring and observability.
        </Text>
      </VStack>

      <Separator />

      <VStack align="stretch" gap={3}>
        <Text textStyle="md" fontWeight="semibold">
          Advanced Configuration
        </Text>
        <Text textStyle="sm" color="fg.muted">
          Optional: Customize what LangWatch captures from your Langflow components
        </Text>

        <Accordion.Root
          value={accordionValue}
          onValueChange={(e) => setAccordionValue(e.value)}
          multiple
          variant="enclosed"
        >
          {accordionItems.map((item) => (
            <Accordion.Item key={item.value} value={item.value}>
              <Accordion.ItemTrigger>
                <Text fontWeight="medium" fontSize="sm">
                  {item.title}
                </Text>
              </Accordion.ItemTrigger>
              <Accordion.ItemContent>
                <VStack align="stretch" gap={3} py={3}>
                  <Text fontSize="sm" color="fg.muted">
                    {item.description}
                  </Text>
                  <CodePreview
                    code={item.code}
                    filename={item.filename}
                    codeLanguage="python"
                  />
                  {item.instructions && (
                    <VStack align="stretch" gap={1}>
                      <Text fontSize="sm" fontWeight="medium">
                        How to implement:
                      </Text>
                      {item.instructions.map((instruction, idx) => (
                        <Text key={idx} fontSize="sm" color="fg.muted" pl={4}>
                          {idx + 1}. {instruction}
                        </Text>
                      ))}
                    </VStack>
                  )}
                </VStack>
              </Accordion.ItemContent>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </VStack>
    </VStack>
  );
}

