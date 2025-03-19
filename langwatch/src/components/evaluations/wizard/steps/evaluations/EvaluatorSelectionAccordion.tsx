import {
  Accordion,
  Grid,
  HStack,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useEvaluationWizardStore } from "~/hooks/useEvaluationWizardStore";
import { evaluatorCategories } from "./CategorySelectionAccordion";

export const EvaluatorSelectionAccordion = ({
  setAccordeonValue,
}: {
  setAccordeonValue: (value: string[]) => void;
}) => {
  const { wizardState, getFirstEvaluator, setFirstEvaluator } =
    useEvaluationWizardStore();

  const handleEvaluatorSelect = (evaluatorType: string) => {
    setFirstEvaluator({
      evaluator: evaluatorType,
    });

    const nextStep =
      wizardState.task == "real_time" &&
      wizardState.dataSource == "from_production"
        ? ["settings"]
        : ["mappings"];
    setAccordeonValue(nextStep);
  };

  return (
    <Accordion.Item
      value="selection"
      width="full"
      hidden={!wizardState.evaluatorCategory}
    >
      <Accordion.ItemTrigger width="full">
        <HStack width="full" alignItems="center" paddingX={2} paddingY={3}>
          <VStack width="full" align="start" gap={1}>
            <Text>Evaluator Selection</Text>
          </VStack>
          <Accordion.ItemIndicator>
            <ChevronDown />
          </Accordion.ItemIndicator>
        </HStack>
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        <RadioCard.Root
          variant="outline"
          colorPalette="green"
          value={getFirstEvaluator()?.evaluator}
          onValueChange={(e: { value: string }) => {
            handleEvaluatorSelect(e.value);
          }}
          paddingTop={2}
          paddingBottom={5}
          paddingX="1px"
        >
          <Grid width="full" gap={3}>
            {evaluatorCategories
              .find((c) => c.id === wizardState.evaluatorCategory)
              ?.evaluators.map((evaluator) => (
                <RadioCard.Item
                  key={evaluator.id}
                  value={evaluator.id}
                  width="full"
                  minWidth={0}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!evaluator.future && !evaluator.disabled) {
                      handleEvaluatorSelect(evaluator.id);
                    }
                  }}
                  opacity={evaluator.future ?? evaluator.disabled ? 0.5 : 1}
                  cursor={
                    evaluator.future ?? evaluator.disabled
                      ? "not-allowed"
                      : "pointer"
                  }
                >
                  <RadioCard.ItemHiddenInput />
                  <RadioCard.ItemControl
                    cursor={
                      evaluator.future ?? evaluator.disabled
                        ? "not-allowed"
                        : "pointer"
                    }
                    width="full"
                  >
                    <RadioCard.ItemContent width="full">
                      <VStack align="start" gap={1} width="full">
                        <HStack>
                          <Text fontWeight="semibold">{evaluator.name}</Text>
                          {evaluator.future && (
                            <Text as="span" fontSize="xs" color="gray.500">
                              (Coming Soon)
                            </Text>
                          )}
                        </HStack>
                        <Text
                          fontSize="sm"
                          color="gray.500"
                          fontWeight="normal"
                        >
                          {evaluator.description}
                        </Text>
                      </VStack>
                    </RadioCard.ItemContent>
                    <RadioCard.ItemIndicator />
                  </RadioCard.ItemControl>
                </RadioCard.Item>
              ))}
          </Grid>
        </RadioCard.Root>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
};
