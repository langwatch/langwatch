import { Box, Steps as ChakraSteps, VStack } from "@chakra-ui/react";
import * as React from "react";
import { LuCheck } from "react-icons/lu";

interface StepInfoProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
}

export interface StepsItemProps
  extends Omit<ChakraSteps.ItemProps, "title">,
    StepInfoProps {
  completedIcon?: React.ReactNode;
  icon?: React.ReactNode;
}

export const StepsItem = React.forwardRef<HTMLDivElement, StepsItemProps>(
  function StepsItem(props, ref) {
    const { title, description, completedIcon, icon, ...rest } = props;
    return (
      <ChakraSteps.Item {...rest} ref={ref} marginBottom="28px">
        <ChakraSteps.Trigger position="relative">
          <VStack gap={0}>
            <ChakraSteps.Indicator>
              <ChakraSteps.Status
                complete={completedIcon ?? <LuCheck />}
                incomplete={icon ?? <ChakraSteps.Number />}
              />
            </ChakraSteps.Indicator>
            <Box position="absolute" bottom="-28px">
              <StepInfo title={title} description={description} />
            </Box>
          </VStack>
        </ChakraSteps.Trigger>
        <ChakraSteps.Separator />
      </ChakraSteps.Item>
    );
  }
);

const StepInfo = (props: StepInfoProps) => {
  const { title, description } = props;

  if (title && description) {
    return (
      <Box>
        <ChakraSteps.Title>{title}</ChakraSteps.Title>
        <ChakraSteps.Description>{description}</ChakraSteps.Description>
      </Box>
    );
  }

  return (
    <>
      {title && <ChakraSteps.Title>{title}</ChakraSteps.Title>}
      {description && (
        <ChakraSteps.Description>{description}</ChakraSteps.Description>
      )}
    </>
  );
};

interface StepsIndicatorProps {
  completedIcon: React.ReactNode;
  icon?: React.ReactNode;
}

export const StepsIndicator = React.forwardRef<
  HTMLDivElement,
  StepsIndicatorProps
>(function StepsIndicator(props, ref) {
  const { icon = <ChakraSteps.Number />, completedIcon } = props;
  return (
    <ChakraSteps.Indicator ref={ref}>
      <ChakraSteps.Status complete={completedIcon} incomplete={icon} />
    </ChakraSteps.Indicator>
  );
});

export const StepsList = ChakraSteps.List;
export const StepsRoot = ChakraSteps.Root;
export const StepsContent = ChakraSteps.Content;
export const StepsCompletedContent = ChakraSteps.CompletedContent;

export const StepsNextTrigger = ChakraSteps.NextTrigger;
export const StepsPrevTrigger = ChakraSteps.PrevTrigger;

export const Steps = {
  Root: StepsRoot,
  List: StepsList,
  Item: StepsItem,
  Content: StepsContent,
  CompletedContent: StepsCompletedContent,
};
