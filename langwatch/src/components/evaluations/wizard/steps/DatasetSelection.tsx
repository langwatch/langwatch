import { Heading, Text, VStack } from "@chakra-ui/react";
import { FileText, FilePlus, Database, UploadCloud, Book } from "react-feather";
import { ColorfulBlockIcon } from "../../../../optimization_studio/components/ColorfulBlockIcons";
import { StepButton } from "../../StepButton";
import { useEvaluationWizardStore } from "~/hooks/useEvaluationWizardStore";
import { Library } from "lucide-react";

export function DatasetSelection() {
  const { setWizardState } = useEvaluationWizardStore();

  return (
    <>
      <VStack align="start" paddingTop={6}>
        <Heading as="h2" size="md">
          Datasets
        </Heading>
        <Text>Choose where your evaluation data will come from</Text>
      </VStack>
      <VStack width="full" gap={3}>
        <StepButton
          title="Choose existing dataset"
          description="Select from your previously created datasets"
          onClick={() => setWizardState({ step: "executor", dataSource: "choose" })}
          icon={
            <ColorfulBlockIcon
              color="blue.400"
              size="md"
              icon={<Database />}
              marginTop="-2px"
            />
          }
        />
        <StepButton
          title="Import from Production"
          description="Import tracing data from production to test the evaluator"
          onClick={() => setWizardState({ step: "executor", dataSource: "from_production" })}
          icon={
            <ColorfulBlockIcon
              color="purple.400"
              size="md"
              icon={<FileText />}
              marginTop="-2px"
            />
          }
        />
        <StepButton
          title="Create manually"
          description="Insert some initial test data manually, use AI to expand it"
          onClick={() => setWizardState({ step: "executor", dataSource: "manual" })}
          icon={
            <ColorfulBlockIcon
              color="green.400"
              size="md"
              icon={<FilePlus />}
              marginTop="-2px"
            />
          }
        />
        <StepButton
          title="Upload CSV"
          description="Upload your pre-existing dataset from Excel or CSV"
          onClick={() => setWizardState({ step: "executor", dataSource: "upload" })}
          icon={
            <ColorfulBlockIcon
              color="orange.400"
              size="md"
              icon={<UploadCloud />}
              marginTop="-2px"
            />
          }
        />
        <StepButton
          title="(Future) Generate Synthetic Dataset from Documents"
          description="Generate questions and answers based on documents you upload"
          icon={
            <ColorfulBlockIcon
              color="teal.400"
              size="md"
              icon={<Book />}
              marginTop="-2px"
            />
          }
          disabled
        />
        <StepButton
          title="(Future) Dataset Library"
          description="Select from 100+ existing datasets from various domains"
          icon={
            <ColorfulBlockIcon
              color="gray.400"
              size="md"
              icon={<Library />}
              marginTop="-2px"
            />
          }
          disabled
        />
      </VStack>
    </>
  );
}
