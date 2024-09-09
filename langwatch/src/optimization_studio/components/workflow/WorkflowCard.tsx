import { Divider, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { WorkflowIcon } from "../ColorfulBlockIcons";

export function WorkflowCardBase(props: React.ComponentProps<typeof VStack>) {
  return (
    <VStack
      align="start"
      padding={4}
      spacing={4}
      borderRadius={8}
      background="white"
      boxShadow="md"
      height="200px"
      cursor="pointer"
      role="button"
      {...props}
    >
      {props.children}
    </VStack>
  );
}

export function WorkflowCard({
  name,
  icon,
  description,
  children,
  ...props
}: {
  name: string;
  icon: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
} & React.ComponentProps<typeof WorkflowCardBase>) {
  return (
    <WorkflowCardBase paddingX={0} {...props}>
      <HStack spacing={4} paddingX={4}>
        <WorkflowIcon icon={icon} size={"lg"} />
        <Heading as={"h2"} size="sm" fontWeight={600}>
          {name}
        </Heading>
        {children}
      </HStack>
      <Divider />
      {description && <Text paddingX={4} color="gray.600" fontSize={14}>{description}</Text>}
    </WorkflowCardBase>
  );
}
