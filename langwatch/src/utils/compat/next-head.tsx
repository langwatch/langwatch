/**
 * Compatibility layer: next/head → react-helmet-async
 * Provides a simple Head component that updates document head.
 */
import { useEffect, type ReactNode } from "react";

interface HeadProps {
  children?: ReactNode;
}

/**
 * Simple Head component that processes children to update document.title.
 * For the basic usage in this app (just <title>), we don't need react-helmet-async.
 */
export default function Head({ children }: HeadProps) {
  useEffect(() => {
    // Extract title from children
    if (children) {
      const childArray = Array.isArray(children) ? children : [children];
      for (const child of childArray) {
        if (
          child &&
          typeof child === "object" &&
          "type" in child &&
          child.type === "title" &&
          child.props?.children
        ) {
          document.title = String(child.props.children);
        }
      }
    }
  }, [children]);

  return null;
}
