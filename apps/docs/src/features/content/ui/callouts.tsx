import { Banner } from "@langwatch/design-system/banner";
import type { BannerStatus } from "@langwatch/design-system/banner";
import { Box } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

const STATUS = {
  note: "info",
  info: "info",
  tip: "info",
  warning: "warning",
  check: "success",
} satisfies Record<string, BannerStatus>;

function Callout({ kind, children }: { kind: keyof typeof STATUS; children?: ReactNode }) {
  return (
    <Box className="docs-callout" marginY="6">
      <Banner status={STATUS[kind]} title={kind === "warning" ? "Warning" : void 0}>
        {children}
      </Banner>
    </Box>
  );
}

export const Note = ({ children }: { children?: ReactNode }) => (
  <Callout kind="note">{children}</Callout>
);
export const Info = ({ children }: { children?: ReactNode }) => (
  <Callout kind="info">{children}</Callout>
);
export const Tip = ({ children }: { children?: ReactNode }) => (
  <Callout kind="tip">{children}</Callout>
);
export const Warning = ({ children }: { children?: ReactNode }) => (
  <Callout kind="warning">{children}</Callout>
);
export const Check = ({ children }: { children?: ReactNode }) => (
  <Callout kind="check">{children}</Callout>
);
