import type {
  CardRootProps,
  ButtonProps as ChakraButtonProps,
  ContainerProps as ChakraContainerProps,
  HeadingProps as ChakraHeadingProps,
  StackProps as ChakraStackProps,
  TextProps as ChakraTextProps,
} from "@chakra-ui/react";
import {
  Button,
  Card,
  Container as ChakraContainer,
  Heading as ChakraHeading,
  HStack,
  mergeRefs,
  Text,
} from "@chakra-ui/react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
  type Ref,
} from "react";

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
  ref?: Ref<HTMLDivElement>;
  withBorder?: boolean;
  actions?: ReactNode;
}

function Header({
  children,
  withBorder = true,
  actions,
  ref,
  ...props
}: PropsWithChildren<HeaderProps>) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = () => {
      let hasScroll = window.scrollY > 0;
      for (let parent = header.parentElement; parent; parent = parent.parentElement) {
        hasScroll ||= parent.scrollTop > 0;
      }
      setScrolled(hasScroll);
    };
    // Capture handles nested page scrollers, including a section header's
    // horizontal wrapper, without treating an unrelated drawer as this page.
    const onScroll = (event: Event) => {
      if (
        event.target === document ||
        (event.target instanceof Element && event.target.contains(header))
      )
        update();
    };
    update();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  return (
    <HStack
      ref={mergeRefs(headerRef, ref)}
      data-page-header
      data-scrolled={scrolled ? "true" : "false"}
      height="shellHeader"
      minHeight="shellHeader"
      flexShrink={0}
      paddingX={6}
      paddingY={1.5}
      alignItems="center"
      width="full"
      borderBottomWidth={withBorder ? "1px" : 0}
      borderBottomStyle={withBorder ? "solid" : "none"}
      borderBottomColor={withBorder && scrolled ? "border.card" : "transparent"}
      transition="border-color 160ms ease"
      _motionReduce={{ transition: "none" }}
      gap={3}
      position="sticky"
      top={0}
      zIndex={10}
      background="color-mix(in srgb, var(--chakra-colors-bg-surface) var(--lw-panel-alpha, 65%), transparent)"
      backdropFilter="var(--lw-backdrop-blur, blur(16px))"
      {...props}
    >
      {children}
      {actions && (
        <HStack marginStart="auto" flexShrink={0} gap={2}>
          {actions}
        </HStack>
      )}
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
    <ChakraHeading
      as="h1"
      size={size}
      fontWeight="semibold"
      letterSpacing="-0.01em"
      minWidth={0}
      overflowWrap="anywhere"
      {...props}
    >
      {children}
    </ChakraHeading>
  );
}

function Subtitle(props: ChakraTextProps) {
  return <Text color="fg.muted" fontSize="xs" lineHeight="short" {...props} />;
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
    <Button
      variant="outline"
      size="sm"
      flexShrink={0}
      {...(primary ? PRIMARY_PROPS : {})}
      {...props}
    >
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
  Subtitle,
  HeaderButton,
};
