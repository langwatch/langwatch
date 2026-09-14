/**
 * Compatibility layer: next/head → react-helmet-async
 * Provides a simple Head component that updates document head.
 */
import { Fragment, isValidElement, type ReactNode, useLayoutEffect } from "react";

interface HeadProps {
  children?: ReactNode;
}

/**
 * Recursively flatten title children to a plain string.
 * Handles strings, numbers, arrays, and React Fragments.
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
 * Simple Head component that updates document.title from children.
 * Uses useLayoutEffect to avoid flashing the parent route's title.
 */
export default function Head({ children }: HeadProps) {
  useLayoutEffect(() => {
    const title = titleFromHeadChildren(children);
    if (title) document.title = title;
  }, [children]);

  return null;
}
