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
import { createContext, useContext, type PropsWithChildren } from "react";

// Container component
interface ContainerProps extends ChakraContainerProps {
  sidebarWidth?: number;
}

/**
 * Container component
 * @param children - The children to render inside the container
 * @param sidebarWidth - Width of sidebar (default 200px); used to calculate container max width
 * @param props - The props to pass to the container
 * @returns A container component with a max width based on the sidebar width
 */
function Container({ children, sidebarWidth = 200, ...props }: PropsWithChildren<ContainerProps>) {
  return (
    <ChakraContainer
      data-page-container
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

function Header({ children, withBorder = true, ...props }: PropsWithChildren<HeaderProps>) {
  return (
    <HStack
      data-page-header
      height="48px"
      flexShrink={0}
      paddingX={6}
      width="full"
      borderBottom={withBorder ? "1px solid" : undefined}
      borderBottomColor={withBorder ? "border" : undefined}
      gap={2}
      position="sticky"
      top={0}
      zIndex={10}
      background="bg.surface"
      {...props}
    >
      {children}
    </HStack>
  );
}

// Page titles render at the standard Heading size; callers never size one.
// The shell mounts PageHeadingSizeProvider over account pages, which the route
// table marks, so their title draws large. See dev/docs/best_practices/react.md.
const PageHeadingSizeContext = createContext<"lg" | undefined>(undefined);

export function PageHeadingSizeProvider({ size, children }: PropsWithChildren<{ size: "lg" }>) {
  return <PageHeadingSizeContext.Provider value={size}>{children}</PageHeadingSizeContext.Provider>;
}

type HeadingProps = Omit<ChakraHeadingProps, "size" | "fontSize">;

function Heading({ children, ...props }: PropsWithChildren<HeadingProps>) {
  const size = useContext(PageHeadingSizeContext);
  return (
    <ChakraHeading as="h1" size={size} {...props}>
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

type HeaderButtonProps = ChakraButtonProps & { primary?: boolean };

const PRIMARY_PROPS = { variant: "solid", colorPalette: "orange" } as const;

function HeaderButton({
  children,
  primary = false,
  ...props
}: PropsWithChildren<HeaderButtonProps>) {
  return (
    <Button variant="outline" size="sm" {...(primary ? PRIMARY_PROPS : {})} {...props}>
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
