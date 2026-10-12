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
      // A phone has no sidebar beside the page, so the page takes the full width.
      maxW={width === "fill" ? "full" : { base: "full", md: `calc(100vw - ${sidebarWidth}px)` }}
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

/** Whether the page has scrolled under the header, as `data-scrolled` for styles reading it. */
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
        borderBottomColor="border"
        gap={3}
        position="sticky"
        top={0}
        zIndex={10}
        // Opaque, so content scrolling under the sticky header never shows through it.
        background="bg.surface"
        {...props}
        // Actions wrap under the title when they do not fit, so the header grows to hold them.
        height="auto"
        minHeight={`pageHeader.${size}`}
        maxHeight="none"
        paddingX={PAGE_INSET}
        paddingTop={described ? 3 : 0}
        paddingBottom={described ? 3 : { base: 0, mdDown: 2 }}
        flexWrap="wrap"
        rowGap={2}
        css={{
          "& h1": {
            textStyle: "pageTitleCompact",
            lineHeight: "28px",
            height: described ? "28px" : { base: "28px", mdDown: "auto" },
            margin: 0,
            flexShrink: 1,
            minWidth: 0,
            overflow: described ? "hidden" : undefined,
            textOverflow: described ? "ellipsis" : undefined,
            whiteSpace: described ? "nowrap" : { base: "nowrap", mdDown: "normal" },
            overflowWrap: "break-word",
          },
          "& .chakra-button": {
            height: size === "lg" ? "32px" : "28px",
            minHeight: size === "lg" ? "32px" : "28px",
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
            marginStart={{ base: 0, md: "auto" }}
            minWidth={0}
            maxWidth="full"
            flexWrap="wrap"
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
  return (
    <ChakraHeading
      as="h1"
      textStyle="pageTitleCompact"
      lineHeight="28px"
      height={{ base: "28px", mdDown: "auto" }}
      flexShrink={0}
      minWidth={0}
      overflow={{ base: "hidden", mdDown: "visible" }}
      textOverflow={{ base: "ellipsis", mdDown: "clip" }}
      whiteSpace={{ base: "nowrap", mdDown: "normal" }}
      // break-word, not anywhere: a title shrinks to its longest word, never to one letter.
      overflowWrap="break-word"
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
  /** The page's one main act. Header buttons are all outlined; this only marks which one it is. */
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
  return (
    <Button
      variant="outline"
      size={size === "lg" ? "sm" : "xs"}
      flexShrink={0}
      data-primary={primary ? "" : undefined}
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
