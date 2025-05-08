import {
  Container as ChakraContainer,
  HStack,
  Heading as ChakraHeading,
  Card,
  Button,
} from "@chakra-ui/react";
import type {
  ContainerProps as ChakraContainerProps,
  StackProps as ChakraStackProps,
  HeadingProps as ChakraHeadingProps,
  ButtonProps as ChakraButtonProps,
  CardRootProps,
} from "@chakra-ui/react";
import { type PropsWithChildren } from "react";

// Container component
interface ContainerProps extends ChakraContainerProps {
  sidebarWidth?: number;
}

function Container({
  children,
  sidebarWidth = 200,
  ...props
}: PropsWithChildren<ContainerProps>) {
  return (
    <ChakraContainer
      maxW={`calc(100vw - ${sidebarWidth}px)`}
      padding={6}
      marginTop={8}
      {...props}
    >
      {children}
    </ChakraContainer>
  );
}

// Header component
interface HeaderProps extends ChakraStackProps {}

function Header({ children, ...props }: PropsWithChildren<HeaderProps>) {
  return (
    <HStack width="full" align="top" gap={6} paddingBottom={6} {...props}>
      {children}
    </HStack>
  );
}

interface HeadingProps extends ChakraHeadingProps {}

function Heading({ children, ...props }: PropsWithChildren<HeadingProps>) {
  return (
    <ChakraHeading as="h1" size="lg" paddingTop={1} {...props}>
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
    <Button colorPalette="blue" minWidth="fit-content" {...props}>
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
