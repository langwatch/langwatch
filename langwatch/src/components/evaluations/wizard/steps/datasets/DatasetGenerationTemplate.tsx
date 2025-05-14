import { Text, HStack, VStack } from "@chakra-ui/react";
import React, { type ReactNode } from "react";

// Define the component types for type safety
type DatasetGenerationTemplateProps = {
  children: ReactNode;
};

// Define the subcomponents with their props
type HeaderProps = {
  children?: ReactNode;
  icon?: ReactNode;
};

type DescriptionProps = {
  children?: ReactNode;
};

type ContentProps = {
  children: ReactNode;
};

// Create the subcomponents
const Header = ({ children, icon }: HeaderProps) => (
  <HStack>
    {icon && icon}
    <Text fontWeight="medium">{children || "AI Data Generation"}</Text>
  </HStack>
);

const Description = ({ children }: DescriptionProps) => (
  <Text fontSize="13px" color="gray.500">
    {children ||
      "Describe the sample data you need for running the evaluation or ask for modifications to the dataset."}
  </Text>
);

const Content = ({ children }: ContentProps) => <>{children}</>;

// Main component with directly assigned subcomponents
function DatasetGenerationTemplateRoot({
  children,
}: DatasetGenerationTemplateProps) {
  return (
    <VStack
      width="full"
      align="start"
      gap={3}
      padding={4}
      borderRadius="md"
      border="1px solid"
      borderColor="gray.200"
    >
      {React.Children.toArray(children).filter(Boolean)}
    </VStack>
  );
}

/**
 * DatasetGenerationTemplate is a compound component for creating dataset generation templates
 * with standardized header, description, and content sections.
 *
 * Usage:
 * <DatasetGenerationTemplate>
 *   <DatasetGenerationTemplate.Header>Custom Header</DatasetGenerationTemplate.Header>
 *   <DatasetGenerationTemplate.Description>Custom Description</DatasetGenerationTemplate.Description>
 *   <DatasetGenerationTemplate.Content>
 *     // Content goes here
 *   </DatasetGenerationTemplate.Content>
 * </DatasetGenerationTemplate>
 */
export const DatasetGenerationTemplate = Object.assign(
  DatasetGenerationTemplateRoot,
  {
    Header,
    Description,
    Content,
  }
);
