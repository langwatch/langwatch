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
  VStack,
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
  type RefObject,
} from "react";

import { useProductAccent } from "../scope/use-product-accent.ts";
import { PageTabMenu, PageTabs } from "./page-header-tabs.tsx";

export type { PageTab } from "./page-header-tabs.tsx";

/** The one left and right edge a page's header and body share; the shell area may set it. */
const PAGE_INSET = "var(--page-inset, var(--chakra-spacing-6))";

/** The page body: `default` fits beside the sidebar; `fill` takes the whole width. */
export interface PageContainerProps {
  width?: "default" | "fill";
  children: ReactNode;
  "data-testid"?: string;
}

/** @deprecated Open style props; pass `width="fill"` instead of `maxWidth="full"`. */
interface LegacyContainerProps extends ChakraContainerProps {
  sidebarWidth?: number;
}

function Container(props: PageContainerProps): ReactNode;
/** @deprecated Pass only `width`, `children` and `data-testid`. */
function Container(props: PropsWithChildren<LegacyContainerProps>): ReactNode;
function Container({
  children,
  sidebarWidth = 200,
  width,
  ...props
}: PropsWithChildren<LegacyContainerProps> & { "data-testid"?: string }): ReactNode {
  const named = width === "fill" || width === "default";
  return (
    <ChakraContainer
      data-page-container
      maxW={width === "fill" ? "full" : `calc(100vw - ${sidebarWidth}px)`}
      paddingX={PAGE_INSET}
      paddingY={3}
      width={named ? undefined : width}
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
  /** What the page is, in one muted body line under the title; the header grows to fit it. */
  description?: ReactNode;
  children: ReactNode;
  "data-testid"?: string;
}

/** @deprecated Open style props; the header's size, border and padding belong to the area. */
export interface LegacyHeaderProps extends ChakraStackProps {
  size?: PageHeaderSize;
  ref?: Ref<HTMLDivElement>;
  withBorder?: boolean;
  actions?: ReactNode;
  description?: ReactNode;
}

/** Whether the page has scrolled under the header, so its reserved hairline can show. */
function useContentScrolled({ headerRef }: { headerRef: RefObject<HTMLDivElement | null> }) {
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
  }, [headerRef]);
  return scrolled;
}

/** A bordered title row is nudged by the rule; a described header pads by the scale. */
function headerPaddingTop({ described, withBorder }: { described: boolean; withBorder: boolean }) {
  if (described) return 3;
  return withBorder ? "1px" : 0;
}

function Header(props: PageHeaderProps): ReactNode;
/** @deprecated Pass only `actions`, `children` and `data-testid`. */
function Header(props: PropsWithChildren<LegacyHeaderProps>): ReactNode;
function Header({
  children,
  withBorder = true,
  size: requestedSize = "lg",
  actions,
  description,
  ref,
  ...props
}: PropsWithChildren<LegacyHeaderProps>): ReactNode {
  const described = description !== undefined && description !== null && description !== false;
  const size = useContext(PageHeaderAreaContext) ?? requestedSize;
  const headerRef = useRef<HTMLDivElement>(null);
  const scrolled = useContentScrolled({ headerRef });
  const paddingTop = headerPaddingTop({ described, withBorder });

  return (
    <HeaderSizeContext.Provider value={size}>
      <HStack
        ref={mergeRefs(headerRef, ref)}
        data-page-header
        data-scrolled={scrolled ? "true" : "false"}
        data-header-size={size}
        flexShrink={0}
        alignItems={described ? "flex-start" : "center"}
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
        height={described ? "auto" : `pageHeader.${size}`}
        minHeight={`pageHeader.${size}`}
        maxHeight={described ? "none" : `pageHeader.${size}`}
        paddingX={PAGE_INSET}
        paddingTop={paddingTop}
        paddingBottom={described ? 3 : 0}
        flexWrap={described ? "wrap" : "nowrap"}
        rowGap={described ? 2 : undefined}
        css={{
          "& h1": {
            textStyle: size === "lg" ? "pageTitle" : "pageTitleCompact",
            lineHeight: "28px",
            height: "28px",
            margin: 0,
            flexShrink: described ? 1 : 0,
            minWidth: described ? 0 : undefined,
            overflow: described ? "hidden" : undefined,
            textOverflow: described ? "ellipsis" : undefined,
            whiteSpace: "nowrap",
          },
          "& .chakra-button": {
            height: size === "lg" ? "36px" : "28px",
            minHeight: size === "lg" ? "36px" : "28px",
          },
          ...props.css,
        }}
      >
        {described ? (
          <VStack align="stretch" gap={1} flex="1 1 16rem" minWidth={0}>
            <HStack gap={3} minWidth={0}>
              {children}
            </HStack>
            <Text data-header-description textStyle="body" color="fg.muted">
              {description}
            </Text>
          </VStack>
        ) : (
          children
        )}
        {actions && (
          <HStack
            data-header-actions
            marginStart={described ? 0 : "auto"}
            marginTop={described && size === "lg" ? "-1" : 0}
            minWidth={0}
            overflowX="auto"
            gap={2}
          >
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
  return <Text color="fg.muted" textStyle="body" {...props} />;
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
  /** The page's one main act: solid in the product's accent. */
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

function HeaderButton(props: HeaderButtonProps): ReactNode;
/** @deprecated Style props; the header owns the button's look. */
function HeaderButton(props: PropsWithChildren<LegacyHeaderButtonProps>): ReactNode;
function HeaderButton({
  children,
  primary = false,
  ...props
}: PropsWithChildren<LegacyHeaderButtonProps>): ReactNode {
  const size = useContext(HeaderSizeContext);
  const accent = useProductAccent();
  return (
    <Button
      variant="outline"
      size={size === "lg" ? "md" : "xs"}
      flexShrink={0}
      {...(primary ? { variant: "solid", colorPalette: accent.colorPalette } : {})}
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
