import type {
  CardRootProps,
  ButtonProps as ChakraButtonProps,
  ContainerProps as ChakraContainerProps,
  HeadingProps as ChakraHeadingProps,
  StackProps as ChakraStackProps,
} from "@chakra-ui/react";
import {
  Button,
  Card,
  Container as ChakraContainer,
  Heading as ChakraHeading,
  HStack,
} from "@chakra-ui/react";
import type { PropsWithChildren } from "react";

// Container component
interface ContainerProps extends ChakraContainerProps {
  sidebarWidth?: number;
}

/**
 * Container component
 * @param children - The children to render inside the container
 * @param sidebarWidth - The width of the sidebar - defaults to 200px and will be used to calculate the max width of the container
 * @param props - The props to pass to the container
 * @returns A container component with a max width based on the sidebar width
 */
function Container({
  children,
  sidebarWidth = 200,
  ...props
}: PropsWithChildren<ContainerProps>) {
  return (
    <ChakraContainer
      maxW={`calc(100vw - ${sidebarWidth}px)`}
      paddingX={6}
      paddingY={3}
      {...props}
    >
      {children}
    </ChakraContainer>
  );
}

// Header component
interface HeaderProps extends ChakraStackProps {
  withBorder?: boolean;
}

function Header({
  children,
  withBorder = true,
  ...props
}: PropsWithChildren<HeaderProps>) {
  return (
    <HStack
      height="48px"
      flexShrink={0}
      paddingX={6}
      width="full"
      borderBottom={withBorder ? "1px solid" : undefined}
      borderBottomColor={withBorder ? "gray.100" : undefined}
      gap={2}
      {...props}
    >
      {children}
    </HStack>
  );
}

interface HeadingProps extends ChakraHeadingProps {}

function Heading({ children, ...props }: PropsWithChildren<HeadingProps>) {
  return (
    <ChakraHeading as="h1" {...props}>
      {children}
    </ChakraHeading>
  );
}

// Content component
function Content({ children, ...props }: PropsWithChildren<CardRootProps>) {
  return (
    <Card.Root {...props}>
      <Card.Body>{children}</Card.Body>
    </Card.Root>
  );
}

interface HeaderButtonProps extends ChakraButtonProps {}

function HeaderButton({
  children,
  ...props
}: PropsWithChildren<HeaderButtonProps>) {
  return (
    <Button variant="outline" size="sm" {...props}>
      {children}
    </Button>
  );
}

// Export as a namespace
export const PageLayout = {
  Container,
  Header,
  Content,
  Heading,
  HeaderButton,
};
