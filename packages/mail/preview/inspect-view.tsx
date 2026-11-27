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
import { documentUrl as documentUrlOf, fetchRender, isStaticStudio } from "./studio-endpoints.ts";
import { groupTemplates, stepSelection } from "./studio-groups.ts";
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
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);

  const template = templates.find((entry) => entry.id === selected?.id) ?? null;
  const fixtureIndex =
    template?.fixtures.findIndex((fixture) => fixture.name === selected?.fixture) ?? -1;

  useArrowKeyStepping({ templates, selected, onSelect, frame });

  useEffect(() => {
    if (!selected || currentProps === null) return;
    const controller = new AbortController();
    fetchRender({ id: selected.id, fixtureIndex, props: currentProps, signal: controller.signal })
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
  }, [selected, fixtureIndex, currentProps]);

  const documentUrl = selected
    ? documentUrlOf({ id: selected.id, fixtureIndex, props: currentProps })
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
        <nav className="mailroom-messages" aria-label="Messages">
          <ScrollArea className="mailroom-message-list" label="Messages">
            <MessageList templates={templates} selected={selected} onSelect={onSelect} />
          </ScrollArea>
        </nav>

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
                  <iframe ref={setFrame} title="Rendered email" srcDoc={frameHtml} />
                </div>
              ) : (
                <div className="mailroom-text" style={{ width: WIDTHS[width] }}>
                  <CodeBlock code={rendered?.text ?? ""} label="Plain text" wrap />
                </div>
              )}
            </div>
          </Panel>
          <details className="mailroom-props">
            <summary>{isStaticStudio ? "Sample data" : "Edit sample data"}</summary>
            <PropsPanelBody
              template={template}
              currentProps={currentProps}
              onPropsChange={onPropsChange}
            />
          </details>
        </Stack>
      </div>
    </Page>
  );
};

const ARROW_DIRECTION: Record<string, 1 | -1> = { ArrowRight: 1, ArrowLeft: -1 };

/** Typing or a control's own arrow handling keeps its keys; modified arrows are the browser's. */
const keepsArrowKeys = (event: KeyboardEvent): boolean => {
  if (event.defaultPrevented) return true;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
};

/** Left and right arrows step through the message list as clicking would. */
function useArrowKeyStepping({
  templates,
  selected,
  onSelect,
  frame,
}: Pick<InspectViewProps, "templates" | "selected" | "onSelect"> & {
  frame: HTMLIFrameElement | null;
}): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = ARROW_DIRECTION[event.key];
      if (!direction || keepsArrowKeys(event)) return;
      const next = stepSelection({ templates, selected, direction });
      if (!next) return;
      event.preventDefault();
      onSelect(next.id, next.fixture);
    };
    window.addEventListener("keydown", onKeyDown);
    // A click in the rendered email focuses its frame, whose keys never reach this window;
    // every srcdoc load is a new window, so the listener moves on each load.
    let frameWindow: Window | null = null;
    const bindFrame = () => {
      frameWindow?.removeEventListener("keydown", onKeyDown);
      frameWindow = null;
      try {
        frame?.contentWindow?.addEventListener("keydown", onKeyDown);
        frameWindow = frame?.contentWindow ?? null;
      } catch {
        // A cross-origin frame refuses listeners; its keys stay its own.
      }
    };
    bindFrame();
    frame?.addEventListener("load", bindFrame);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      frame?.removeEventListener("load", bindFrame);
      frameWindow?.removeEventListener("keydown", onKeyDown);
    };
  }, [templates, selected, onSelect, frame]);
}

/** The live props form, or under the built studio the fixture's props, read-only. */
function PropsPanelBody({
  template,
  currentProps,
  onPropsChange,
}: {
  template: TemplateSummary | null;
  currentProps: unknown;
  onPropsChange: (next: unknown) => void;
}): JSX.Element {
  if (!template) return <Text tone="secondary">Pick a message to edit its props.</Text>;
  if (!isStaticStudio) {
    return <PropsForm schema={template.formSchema} props={currentProps} onChange={onPropsChange} />;
  }
  return (
    <Stack gap={2}>
      <Text tone="secondary">
        Read-only: this studio was rendered at build time. `pnpm --filter @langwatch/mail dev` edits
        props live.
      </Text>
      <CodeBlock code={JSON.stringify(currentProps, null, 2)} label="Props" wrap />
    </Stack>
  );
}

/** The message list under its headings; a row opens its first variant, chips pick another. */
function MessageList({
  templates,
  selected,
  onSelect,
}: Pick<InspectViewProps, "templates" | "selected" | "onSelect">): JSX.Element {
  return (
    <Stack gap={4}>
      {groupTemplates({ templates }).map((group) => (
        <section key={group.heading} className="mailroom-group">
          <h2 className="mailroom-group-heading">{group.heading}</h2>
          <ul className="mailroom-group-list">
            {group.templates.map((entry) => (
              <MessageRow key={entry.id} entry={entry} selected={selected} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      ))}
    </Stack>
  );
}

function MessageRow({
  entry,
  selected,
  onSelect,
}: {
  entry: TemplateSummary;
  selected: InspectViewProps["selected"];
  onSelect: InspectViewProps["onSelect"];
}): JSX.Element {
  const isCurrent = entry.id === selected?.id;
  const firstFixture = entry.fixtures[0];
  return (
    <li>
      <button
        type="button"
        className="mailroom-row"
        aria-current={isCurrent ? "page" : undefined}
        title={entry.sentWhen}
        onClick={() => firstFixture && onSelect(entry.id, firstFixture.name)}
      >
        {entry.title}
      </button>
      {isCurrent && entry.fixtures.length > 1 && (
        <Inline gap={1} wrap>
          {entry.fixtures.map((fixture) => (
            <Button
              key={fixture.name}
              size="sm"
              variant="ghost"
              pressed={fixture.name === selected?.fixture}
              onClick={() => onSelect(entry.id, fixture.name)}
            >
              {fixture.name}
            </Button>
          ))}
        </Inline>
      )}
    </li>
  );
}
