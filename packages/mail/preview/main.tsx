import { StrictMode, useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { PropsForm } from "./props-form";
import "./studio.css";

interface TemplateSummary {
  id: string;
  title: string;
  sentWhen: string;
  fixtures: { name: string; props: unknown }[];
  formSchema: unknown;
}

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const WIDTHS = { desktop: 680, mobile: 375 } as const;

/**
 * Shows the dark half of an email without asking the operating system to change.
 *
 * Nothing lets a page force `prefers-color-scheme` on a frame, so the studio
 * promotes the dark rules the email already carries to unconditional ones. It
 * reads the real stylesheet the message ships, so what appears is what a client
 * in dark mode composes — not a second theme written for the preview.
 */
const promoteDarkRules = (html: string): string => {
  const marker = "@media (prefers-color-scheme: dark)";
  let out = "";
  let cursor = 0;
  for (;;) {
    const start = html.indexOf(marker, cursor);
    if (start === -1) return out + html.slice(cursor);
    const open = html.indexOf("{", start + marker.length);
    if (open === -1) return out + html.slice(cursor);
    let depth = 1;
    let index = open + 1;
    while (index < html.length && depth > 0) {
      if (html[index] === "{") depth += 1;
      else if (html[index] === "}") depth -= 1;
      index += 1;
    }
    out += html.slice(cursor, start) + html.slice(open + 1, index - 1);
    cursor = index;
  }
};

const Studio = (): JSX.Element => {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; fixture: string } | null>(null);
  const [props, setProps] = useState<unknown>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [tab, setTab] = useState<"html" | "text">("html");
  const [width, setWidth] = useState<keyof typeof WIDTHS>("desktop");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    fetch("/__templates")
      .then((response) => response.json())
      .then((body: TemplateSummary[] | { error: string }) => {
        if ("error" in body) {
          setFailure(body.error);
          return;
        }
        setTemplates(body);
        const first = body[0];
        const fixture = first?.fixtures[0];
        if (first && fixture) {
          setSelected({ id: first.id, fixture: fixture.name });
          setProps(fixture.props);
        }
      })
      .catch((error: unknown) => setFailure(String(error)));
  }, []);

  const template = useMemo(
    () => templates?.find((entry) => entry.id === selected?.id) ?? null,
    [templates, selected],
  );

  useEffect(() => {
    if (!selected || props === null) return;
    const controller = new AbortController();
    fetch("/__render", {
      method: "POST",
      body: JSON.stringify({ id: selected.id, props }),
      signal: controller.signal,
    })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (ok) {
          setRendered(body as Rendered);
          setRenderError(null);
        } else {
          setRenderError((body as { error: string }).error);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected, props]);

  const choose = useCallback((entry: TemplateSummary, fixture: { name: string; props: unknown }) => {
    setSelected({ id: entry.id, fixture: fixture.name });
    setProps(fixture.props);
    setRenderError(null);
  }, []);

  if (failure) return <p className="failure">The studio could not load the templates: {failure}</p>;
  if (!templates) return <p className="loading">Loading templates…</p>;

  const documentUrl = selected
    ? `/__document?id=${encodeURIComponent(selected.id)}&props=${encodeURIComponent(JSON.stringify(props))}`
    : "#";
  const frameHtml = rendered ? (dark ? promoteDarkRules(rendered.html) : rendered.html) : "";

  return (
    <div className="studio">
      <nav className="rail">
        <h1>LangWatch mail</h1>
        <p className="rail-note">{templates.length} messages</p>
        {templates.map((entry) => (
          <section key={entry.id} className={entry.id === selected?.id ? "entry current" : "entry"}>
            <h2>{entry.title}</h2>
            <p className="sent-when">{entry.sentWhen}</p>
            <ul>
              {entry.fixtures.map((fixture) => (
                <li key={fixture.name}>
                  <button
                    type="button"
                    className={
                      entry.id === selected?.id && fixture.name === selected.fixture
                        ? "fixture on"
                        : "fixture"
                    }
                    onClick={() => choose(entry, fixture)}
                  >
                    {fixture.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <main className="stage">
        <header>
          <p className="subject-label">Subject</p>
          <p className="subject">{rendered?.subject ?? "—"}</p>
          <div className="toolbar">
            <Toggle options={["html", "text"] as const} value={tab} onChange={setTab} />
            <Toggle options={["desktop", "mobile"] as const} value={width} onChange={setWidth} />
            <button
              type="button"
              className={dark ? "chip on" : "chip"}
              onClick={() => setDark((was) => !was)}
            >
              Dark
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => void navigator.clipboard.writeText(rendered?.html ?? "")}
            >
              Copy HTML
            </button>
            <a className="chip" href={documentUrl} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
          </div>
        </header>
        {renderError && <p className="reject">These props were rejected: {renderError}</p>}
        <div className={dark ? "canvas dark" : "canvas"}>
          {tab === "html" ? (
            <iframe title="Rendered email" srcDoc={frameHtml} style={{ width: WIDTHS[width] }} />
          ) : (
            <pre className="plain" style={{ width: WIDTHS[width] }}>
              {rendered?.text ?? ""}
            </pre>
          )}
        </div>
      </main>

      <aside className="inspector">
        <h2>Props</h2>
        {template && (
          <PropsForm schema={template.formSchema} props={props} onChange={setProps} />
        )}
      </aside>
    </div>
  );
};

const Toggle = <Option extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly Option[];
  value: Option;
  onChange: (next: Option) => void;
}): JSX.Element => (
  <div className="toggle">
    {options.map((option) => (
      <button
        key={option}
        type="button"
        className={option === value ? "chip on" : "chip"}
        onClick={() => onChange(option)}
      >
        {option}
      </button>
    ))}
  </div>
);

const mount = document.getElementById("studio");
if (mount) {
  createRoot(mount).render(
    <StrictMode>
      <Studio />
    </StrictMode>,
  );
}
