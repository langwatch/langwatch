import { Alert } from "@langwatch/design-system/primitives";
import { CircleCheck, Info as InfoGlyph, Lightbulb, StickyNote, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

type Kind = { heading: string; status: "neutral" | "info" | "success" | "warning"; glyph: typeof InfoGlyph };

const KINDS = {
  note: { heading: "Note", status: "neutral", glyph: StickyNote },
  info: { heading: "Info", status: "info", glyph: InfoGlyph },
  tip: { heading: "Tip", status: "success", glyph: Lightbulb },
  warning: { heading: "Warning", status: "warning", glyph: TriangleAlert },
  check: { heading: "Check", status: "success", glyph: CircleCheck },
} satisfies Record<string, Kind>;

function Callout({ kind, children }: { kind: keyof typeof KINDS; children?: ReactNode }) {
  const { heading, status, glyph: Glyph } = KINDS[kind];
  return (
    <Alert.Root status={status} variant="outline" size="lg" role="note" marginY="6" alignItems="flex-start">
      <Alert.Indicator>
        <Glyph size={18} aria-hidden="true" />
      </Alert.Indicator>
      <Alert.Content minWidth="0" color="fg" fontSize="16px" lineHeight="28px" className="docs-callout">
        <Alert.Title fontSize="14px" lineHeight="24px" fontWeight="600">
          {heading}
        </Alert.Title>
        <Alert.Description asChild>
          <div>{children}</div>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

export const Note = ({ children }: { children?: ReactNode }) => <Callout kind="note">{children}</Callout>;
export const Info = ({ children }: { children?: ReactNode }) => <Callout kind="info">{children}</Callout>;
export const Tip = ({ children }: { children?: ReactNode }) => <Callout kind="tip">{children}</Callout>;
export const Warning = ({ children }: { children?: ReactNode }) => <Callout kind="warning">{children}</Callout>;
export const Check = ({ children }: { children?: ReactNode }) => <Callout kind="check">{children}</Callout>;
