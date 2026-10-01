import {
  Button,
  Callout,
  CodeBlock,
  CopyButton,
  Inline,
  Link,
  Page,
  Panel,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
} from "@langwatch/design-system-internal";
import { useEffect, useState, type JSX, type ReactNode } from "react";

import { PropsForm } from "./props-form.tsx";
import {
  prepareMailDocument,
  renderResponseSchema,
  WIDTHS,
  type Rendered,
  type TemplateSummary,
} from "./studio-shared.ts";

type Tab = "html" | "text";
type Width = keyof typeof WIDTHS;

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: "html", label: "HTML" },
  { value: "text", label: "Text" },
];

export const WIDTH_OPTIONS: { value: Width; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

export interface InspectViewProps {
  nav: ReactNode;
  templates: TemplateSummary[];
  selected: { id: string; fixture: string } | null;
  currentProps: unknown;
  onPropsChange: (next: unknown) => void;
  onSelect: (templateId: string, fixtureName: string) => void;
  previewDark: boolean;
  width: keyof typeof WIDTHS;
  onWidthChange: (next: keyof typeof WIDTHS) => void;
}

export const InspectView = ({
  nav,
  templates,
  selected,
  currentProps,
  onPropsChange,
  onSelect,
  previewDark,
  width,
  onWidthChange,
}: InspectViewProps): JSX.Element => {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("html");

  const template = templates.find((entry) => entry.id === selected?.id) ?? null;

  useEffect(() => {
    if (!selected || currentProps === null) return;
    const controller = new AbortController();
    fetch("/__render", {
      method: "POST",
      body: JSON.stringify({ id: selected.id, props: currentProps }),
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((json: unknown) => {
        const body = renderResponseSchema.parse(json);
        if ("error" in body) {
          setRenderError(body.error);
          return;
        }
        setRendered(body);
        setRenderError(null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected, currentProps]);

  const documentUrl = selected
    ? `/__document?id=${encodeURIComponent(selected.id)}&props=${encodeURIComponent(JSON.stringify(currentProps))}`
    : "#";
  const frameHtml = rendered ? prepareMailDocument(rendered.html, previewDark) : "";

  return (
    <Page
      nav={nav}
      width="full"
      title={template?.title ?? "Inspect"}
      subtitle={template?.sentWhen}
      actions={
        <>
          <SegmentedControl label="Part" options={TAB_OPTIONS} value={tab} onChange={setTab} />
          <SegmentedControl
            label="Width"
            options={WIDTH_OPTIONS}
            value={width}
            onChange={onWidthChange}
          />
          <CopyButton value={rendered?.html ?? ""} label="Copy HTML" size="md" showLabel />
          <Link href={documentUrl} external>
            Open in new tab
          </Link>
        </>
      }
    >
      <div className="mailroom-inspect">
        <div className="mailroom-messages">
          <Panel title="Messages" meta={`${templates.length}`}>
            <ScrollArea className="mailroom-message-list" label="Messages">
              <Stack gap={4}>
                {templates.map((entry) => (
                  <TemplateNavEntry
                    key={entry.id}
                    entry={entry}
                    selected={selected}
                    onSelect={onSelect}
                  />
                ))}
              </Stack>
            </ScrollArea>
          </Panel>
        </div>

        <Stack gap={4} className="mailroom-preview">
          {renderError && (
            <Callout tone="error" title="These props were rejected">
              {renderError}
            </Callout>
          )}
          <Panel flush title={<Text truncate>{rendered?.subject ?? "—"}</Text>}>
            <div className="mailroom-stage">
              {tab === "html" ? (
                <div className="mailroom-frame" style={{ width: WIDTHS[width] }}>
                  <iframe title="Rendered email" srcDoc={frameHtml} />
                </div>
              ) : (
                <div className="mailroom-text" style={{ width: WIDTHS[width] }}>
                  <CodeBlock code={rendered?.text ?? ""} label="Plain text" wrap />
                </div>
              )}
            </div>
          </Panel>
        </Stack>

        <div className="mailroom-props">
          <Panel title="Props">
            {template ? (
              <PropsForm
                schema={template.formSchema}
                props={currentProps}
                onChange={onPropsChange}
              />
            ) : (
              <Text tone="secondary">Pick a message to edit its props.</Text>
            )}
          </Panel>
        </div>
      </div>
    </Page>
  );
};

/** One template in the navigation: its title, when it is sent, and a button per fixture. */
function TemplateNavEntry({
  entry,
  selected,
  onSelect,
}: {
  entry: InspectViewProps["templates"][number];
  selected: InspectViewProps["selected"];
  onSelect: InspectViewProps["onSelect"];
}): JSX.Element {
  const isCurrent = entry.id === selected?.id;
  return (
    <Stack gap={2}>
      <Stack gap={1}>
        <Text weight="semibold">{entry.title}</Text>
        <Text size="sm" tone="secondary" as="p">
          {entry.sentWhen}
        </Text>
      </Stack>
      <Inline gap={1} wrap>
        {entry.fixtures.map((fixture) => (
          <Button
            key={fixture.name}
            size="sm"
            variant={isCurrent && fixture.name === selected.fixture ? "primary" : "secondary"}
            onClick={() => onSelect(entry.id, fixture.name)}
          >
            {fixture.name}
          </Button>
        ))}
      </Inline>
    </Stack>
  );
}
