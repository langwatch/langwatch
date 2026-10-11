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
  type MouseEventHandler,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";

import { PageTabMenu, PageTabs } from "./page-header-tabs.tsx";

export type { PageTab } from "./page-header-tabs.tsx";

/** The one left and right edge a page's header and body share; the shell area may set it. */
const PAGE_INSET = "var(--page-inset, var(--chakra-spacing-6))";

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
      paddingX={PAGE_INSET}
      paddingY={3}
      {...props}
    >
      {children}
    </ChakraContainer>
  );
}

// Header component
export type PageHeaderSize = "lg" | "sm";

const PageHeaderAreaContext = createContext<PageHeaderSize | undefined>(void 0);
const HeaderSizeContext = createContext<PageHeaderSize>("lg");

/** An area owns its header geometry; nested pages cannot override it. */
export function PageHeaderSizeProvider({
  size,
  children,
}: PropsWithChildren<{ size: PageHeaderSize }>) {
  const inherited = useContext(PageHeaderAreaContext);
  return (
    <PageHeaderAreaContext.Provider value={inherited ?? size}>
      {children}
    </PageHeaderAreaContext.Provider>
  );
}

/** The page header: a title, optional subtitle, and the actions at the right edge. */
export interface PageHeaderProps {
  /** `HeaderButton`s only; one of them `primary`. */
  actions?: ReactNode;
  children: ReactNode;
  "data-testid"?: string;
}

/** @deprecated Open style props; the header's size, border and padding belong to the area. */
export interface LegacyHeaderProps extends ChakraStackProps {
  size?: PageHeaderSize;
  ref?: Ref<HTMLDivElement>;
  withBorder?: boolean;
  actions?: ReactNode;
}

function Header(props: PageHeaderProps): ReactNode;
/** @deprecated Pass only `actions`, `children` and `data-testid`. */
function Header(props: PropsWithChildren<LegacyHeaderProps>): ReactNode;
function Header({
  children,
  withBorder = true,
  size: requestedSize = "lg",
  actions,
  ref,
  ...props
}: PropsWithChildren<LegacyHeaderProps>): ReactNode {
  const size = useContext(PageHeaderAreaContext) ?? requestedSize;
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
    <HeaderSizeContext.Provider value={size}>
      <HStack
        ref={mergeRefs(headerRef, ref)}
        data-page-header
        data-scrolled={scrolled ? "true" : "false"}
        data-header-size={size}
        flexShrink={0}
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
        height={`pageHeader.${size}`}
        minHeight={`pageHeader.${size}`}
        maxHeight={`pageHeader.${size}`}
        paddingX={PAGE_INSET}
        paddingTop={withBorder ? "1px" : 0}
        paddingBottom={0}
        flexWrap="nowrap"
        css={{
          "& h1": {
            textStyle: size === "lg" ? "pageTitle" : "pageTitleCompact",
            lineHeight: "28px",
            height: "28px",
            margin: 0,
            flexShrink: 0,
            whiteSpace: "nowrap",
          },
          "& .chakra-button": {
            height: size === "lg" ? "36px" : "28px",
            minHeight: size === "lg" ? "36px" : "28px",
          },
          ...props.css,
        }}
      >
        {children}
        {actions && (
          <HStack data-header-actions marginStart="auto" minWidth={0} overflowX="auto" gap={2}>
            {actions}
          </HStack>
        )}
      </HStack>
    </HeaderSizeContext.Provider>
  );
}

/** Kept for existing account-page wrappers; header sizing belongs to the area. */
export const PageHeadingSizeProvider = PageHeaderSizeProvider;

/** @deprecated Open style props; the heading's type is the header's. */
type LegacyHeadingProps = Omit<ChakraHeadingProps, "size" | "fontSize">;

/** The one h1 of the page. */
function Heading(props: { children: ReactNode }): ReactNode;
/** @deprecated Pass only `children`. */
function Heading(props: PropsWithChildren<LegacyHeadingProps>): ReactNode;
function Heading({ children, ...props }: PropsWithChildren<LegacyHeadingProps>): ReactNode {
  const size = useContext(HeaderSizeContext);
  return (
    <ChakraHeading
      as="h1"
      textStyle={size === "lg" ? "pageTitle" : "pageTitleCompact"}
      lineHeight="28px"
      height="28px"
      flexShrink={0}
      minWidth={0}
      truncate
      {...props}
    >
      {children}
    </ChakraHeading>
  );
}

/** The muted line under the title. */
function Subtitle(props: { children: ReactNode }): ReactNode;
/** @deprecated Pass only `children`; padding belongs to the header. */
function Subtitle(props: ChakraTextProps): ReactNode;
function Subtitle(props: ChakraTextProps): ReactNode {
  return <Text color="fg.muted" textStyle="caption" {...props} />;
}

// Content component
function Content({ children, ...props }: PropsWithChildren<CardRootProps>) {
  return (
    <Card.Root {...props}>
      <Card.Body>{children}</Card.Body>
    </Card.Root>
  );
}

/** What every header button takes: appearance is the header's, so no style props. */
interface HeaderButtonBase {
  /** The page's one main act: solid orange. */
  primary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
  "aria-label"?: string;
  /** With the next three, what `Menu.Trigger asChild` needs to name its menu. */
  "aria-expanded"?: boolean | "true" | "false";
  "aria-haspopup"?: boolean | "menu" | "dialog" | "listbox";
  "aria-controls"?: string;
  id?: string;
  "data-testid"?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** A button: `onClick`, or a submit for a form (`form` names one elsewhere). */
interface HeaderActionButtonProps extends HeaderButtonBase {
  asChild?: false;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit";
  form?: string;
  children: ReactNode;
}

/** A link: one router-aware or external `<a>` the caller supplies; the header paints it. */
interface HeaderLinkButtonProps extends HeaderButtonBase {
  asChild: true;
  /** One element carrying `href` (plus `target` and `rel` when external). */
  children: ReactElement;
}

export type HeaderButtonProps = HeaderActionButtonProps | HeaderLinkButtonProps;

/** @deprecated Open Chakra props; pass `HeaderButtonProps`. */
export type LegacyHeaderButtonProps = ChakraButtonProps & { primary?: boolean };

const PRIMARY_PROPS = { variant: "solid", colorPalette: "orange" } as const;

function HeaderButton(props: HeaderButtonProps): ReactNode;
/** @deprecated Style props; the header owns the button's look. */
function HeaderButton(props: PropsWithChildren<LegacyHeaderButtonProps>): ReactNode;
function HeaderButton({
  children,
  primary = false,
  ...props
}: PropsWithChildren<LegacyHeaderButtonProps>): ReactNode {
  const size = useContext(HeaderSizeContext);
  return (
    <Button
      variant="outline"
      size={size === "lg" ? "md" : "xs"}
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
  /** Routed header tabs; see page-header-tabs.tsx. */
  Tabs: PageTabs,
  TabMenu: PageTabMenu,
};
