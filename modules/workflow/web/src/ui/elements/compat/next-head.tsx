/**
 * Compatibility layer: next/head → react-helmet-async
 * Provides a simple Head component that updates document head.
 */
import { Fragment, isValidElement, type ReactNode, useLayoutEffect } from "react";

interface HeadProps {
  children?: ReactNode;
}

/**
 * Recursively flatten title children to a plain string. Handles:
 *   - strings / numbers → coerce to string
 *   - arrays → flatten + join
 *   - React Fragments (<>foo {bar}</>) → recurse into their children
 *   - other React elements → recurse into their children (best-effort;
 *     anything not text-shaped is dropped rather than rendered as
 *     "[object Object]")
 *
 * G62: when DashboardLayout renders `<title>{pageTitle ?? <>...</>}</title>`
 * without a string `pageTitle`, the fallback is a single Fragment element.
 * The previous `String(c)` path serialised that Fragment as "[object Object]"
 * and leaked it into document.title for any route that didn't pass the
 * `pageTitle` prop (settings sub-routes, /me, /-deep links pre-onboarding).
 */
export function extractTitleText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractTitleText).join("");
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode } | undefined;
    if (node.type === Fragment) {
      return extractTitleText(props?.children);
    }
    if (props?.children !== undefined) {
      return extractTitleText(props.children);
    }
    return "";
  }
  return "";
}

/** The title these children ask for, or null when they name none. */
function titleFromHeadChildren(children: ReactNode): string | null {
  if (!children) return null;

  const childArray = Array.isArray(children) ? children : [children];
  let title: string | null = null;
  for (const child of childArray) {
    if (!isValidElement(child) || child.type !== "title") continue;

    const props = child.props as { children?: ReactNode } | undefined;
    const text = extractTitleText(props?.children).trim();
    if (text.length > 0) title = text;
  }

  return title;
}

/**
 * Simple Head component that processes children to update document.title.
 * For the basic usage in this app (just <title>), we don't need react-helmet-async.
 *
 * `useLayoutEffect` (not `useEffect`) fires before the browser paints, so
 * the tab title is correct on first paint instead of flashing the parent
 * route's title (e.g. "LangWatch - Personal Workspace") before flipping
 * to the page-specific title on the next tick. Surfaced as Ariana QA
 * finding G12: cold-load title regression on /governance/teams.
 */
export default function Head({ children }: HeadProps) {
  useLayoutEffect(() => {
    const title = titleFromHeadChildren(children);
    if (title) document.title = title;
  }, [children]);

  return null;
}
