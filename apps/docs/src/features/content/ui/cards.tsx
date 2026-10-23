import { Card as SurfaceCard } from "@langwatch/design-system/card";
import { Box, Link } from "@langwatch/design-system/primitives";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Children, isValidElement } from "react";
import type { ReactNode } from "react";

import { sitePath } from "../../../lib/site-path.ts";
import { Icon } from "./icon.tsx";
import { DocsLink } from "./prose.tsx";

function containsLink({ node }: { node: ReactNode }): boolean {
  return Children.toArray(node).some((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return false;
    if (child.type === DocsLink || child.type === "a") return true;
    return containsLink({ node: child.props.children });
  });
}

type CardProps = {
  title?: string;
  description?: string;
  icon?: string;
  href?: string;
  horizontal?: boolean;
  arrow?: boolean | string;
  children?: ReactNode;
};

/** Full cards put a glyph in a tinted tile, a logo on a light chip; logo-only cards stay bare. */
function CardIcon({ icon, compact }: { icon: string; compact: boolean }) {
  if (compact) return <Icon icon={icon} size={20} />;
  const logo = /^(\/|https?:)/.test(icon) || ["github", "python", "typescript"].includes(icon);
  return (
    <span className="docs-card-icon" data-logo={logo} aria-hidden="true">
      <Icon icon={icon} size={logo ? 20 : 18} />
    </span>
  );
}

/** MDX supplies content and destinations; the shared card owns its surface and interaction. */
export function Card({ title, description, icon, href, arrow, children }: CardProps) {
  const compact = Boolean(icon && !description && !Children.toArray(children).length);
  const linked = Boolean(href && title && !containsLink({ node: children }));
  const Direction = href && /^https?:/.test(href) ? ArrowUpRight : ArrowRight;
  const body = description || children;
  return (
    <Box className="docs-card" data-compact={compact} display="grid" minWidth="0">
      <SurfaceCard
        variant="panel-fill"
        padding={compact ? "sm" : "md"}
        titleLevel={3}
        title={
          title && href && !linked ? <Link href={sitePath({ path: href })}>{title}</Link> : title
        }
        badge={
          href && arrow !== false && arrow !== "false" ? (
            <Direction className="docs-card-arrow" size={16} aria-hidden="true" />
          ) : (
            void 0
          )
        }
        icon={icon ? <CardIcon icon={icon} compact={compact} /> : void 0}
        opener={linked && href ? <a href={sitePath({ path: href })} aria-label={title} /> : void 0}
      >
        {body ? (
          <Box className="docs-card-body" minWidth="0">
            {description ? <p>{description}</p> : children}
          </Box>
        ) : null}
      </SurfaceCard>
    </Box>
  );
}

/** Columns follow the group's own width: one, then two from 480px, three from 840px. */
export function CardGroup({
  cols = 2,
  children,
}: {
  cols?: number | string;
  children?: ReactNode;
}) {
  const max = Number(cols) || 2;
  return (
    <Box marginY="6" css={{ containerType: "inline-size" }}>
      <Box
        className="docs-card-grid"
        display="grid"
        alignItems="stretch"
        gap="3"
        css={{
          gridTemplateColumns: "minmax(0, 1fr)",
          "@container (min-width: 480px)": {
            gridTemplateColumns: max > 1 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
          },
          "@container (min-width: 840px)": {
            gridTemplateColumns: `repeat(${Math.min(Math.max(max, 1), 3)}, minmax(0, 1fr))`,
          },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
