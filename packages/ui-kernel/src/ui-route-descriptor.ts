/**
 * The shape of a route table entry — composition fills it with LangWatch's
 * own pages; kept here so `ui-kernel` names no composition file (§10.1).
 */

export type UiRedirectDescriptor = {
  readonly from: string;
  readonly to: string;
  readonly pinParams?: Readonly<Record<string, string>>;
  readonly renameParams?: Readonly<Record<string, string>>;
  readonly mapSegment?: Readonly<Record<string, string>>;
};

/** A route that renders a page, or a pathless layout route that wraps others. */
export type UiPageRouteDescriptor = {
  readonly path?: string;
  /** The key the composing application registers this page's loader under. */
  readonly page: string;
  /** The explicit native route mount point for a pre-router web installation. */
  readonly webRouteParent?: "project";
  readonly children?: readonly UiRouteDescriptor[];
};

/** A pathless layout the SHELL draws itself, named by the composing application. */
export type UiShellLayout = string;

/**
 * A layout route the shell resolves from its own source. It carries no page
 * key deliberately - a key is an address a MODULE answers for, and no module
 * owns the frame the application draws around every one of them.
 */
export type UiLayoutRouteDescriptor = {
  readonly layout: UiShellLayout;
  /** Always absent: this layout is pathless, and stating it keeps the union readable. */
  readonly path?: undefined;
  readonly children?: readonly UiRouteDescriptor[];
};

/** A retired address that forwards to its new home. */
export type UiRedirectRouteDescriptor = {
  readonly path: string;
  readonly redirect: UiRedirectDescriptor;
};

export type UiRouteDescriptor =
  | UiPageRouteDescriptor
  | UiRedirectRouteDescriptor
  | UiLayoutRouteDescriptor;

/**
 * Every descriptor, flattened into match order — nesting only joins a
 * layout to the pages it wraps, and every path is absolute, so a flat
 * list ranks the same way the router does.
 */
export function uiRouteDescriptors(table: readonly UiRouteDescriptor[]): UiRouteDescriptor[] {
  return table.flatMap((descriptor) =>
    "redirect" in descriptor
      ? [descriptor]
      : [descriptor, ...uiRouteDescriptors(descriptor.children ?? [])],
  );
}
