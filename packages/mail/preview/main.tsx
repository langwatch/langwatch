import "@langwatch/design-system-internal/styles.css";
import "./app.css";
import {
  applyThemeChoice,
  Button,
  Callout,
  consoleLinks,
  IconMonitor,
  IconMoon,
  IconSun,
  Page,
  SegmentedControl,
  Stack,
  Text,
  TopBar,
} from "@langwatch/design-system-internal";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";

import { DigestReviewView } from "./digest-review-view.tsx";
import { InspectView } from "./inspect-view.tsx";
import { templatesUrl } from "./studio-endpoints.ts";
import { isWeeklyDigest } from "./studio-groups.ts";
import {
  templatesResponseSchema,
  type PreviewScheme,
  type TemplateSummary,
  type WIDTHS,
} from "./studio-shared.ts";
import {
  buildSearch,
  decodePropsFragment,
  encodePropsFragment,
  parseUrlState,
} from "./studio-url.ts";
import type { View } from "./studio-url.ts";

const initialUrl = parseUrlState(window.location.search);
const initialPropsOverride = decodePropsFragment(window.location.hash);

const Studio = (): JSX.Element => {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const templatesRef = useRef<TemplateSummary[] | null>(null);
  templatesRef.current = templates;
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<View>(initialUrl.view);
  const [selected, setSelected] = useState<{ id: string; fixture: string } | null>(null);
  const [currentProps, setCurrentProps] = useState<unknown>(null);

  const [previewScheme, setPreviewScheme] = useState<PreviewScheme>(initialUrl.theme);
  const previewDark = useResolvedDark({ scheme: previewScheme });

  const [width, setWidth] = useState<keyof typeof WIDTHS>(initialUrl.width);

  useEffect(() => {
    applyThemeChoice({ choice: previewScheme });
  }, [previewScheme]);

  useEffect(() => {
    fetch(templatesUrl())
      .then((response) => response.json())
      .then((json: unknown) => {
        const body = templatesResponseSchema.parse(json);
        if ("error" in body) {
          setFailure(body.error);
          return;
        }
        // The weekly digests live on their own tab, which reads its own renders.
        const others = body.filter((template) => !isWeeklyDigest(template.id));
        setTemplates(others);
        const picked = pickFixture({
          templates: others,
          templateId: initialUrl.templateId,
          fixtureName: initialUrl.fixtureName,
        });
        if (picked) {
          setSelected({ id: picked.template.id, fixture: picked.fixture.name });
          setCurrentProps(
            propsOrFixture({
              override: initialPropsOverride,
              requestedId: initialUrl.templateId,
              picked,
            }),
          );
        }
      })
      .catch((error: unknown) => setFailure(String(error)));
  }, []);

  const choose = useCallback(
    (templateId: string, fixtureName: string) => {
      const template = templates?.find((entry) => entry.id === templateId);
      const fixture = template?.fixtures.find((entry) => entry.name === fixtureName);
      if (!template || !fixture) return;
      setSelected({ id: template.id, fixture: fixture.name });
      setCurrentProps(fixture.props);
    },
    [templates],
  );

  const inspectTemplates = useMemo(() => templates ?? [], [templates]);

  const suppressNextPush = useRef(false);
  useAddressBarSync({
    view,
    selected,
    width,
    previewScheme,
    currentProps,
    suppressNextPush,
  });

  useEffect(() => {
    const onPopState = () => {
      const state = parseUrlState(window.location.search);
      const props = decodePropsFragment(window.location.hash);
      suppressNextPush.current = true;
      setView(state.view);
      setWidth(state.width);
      setPreviewScheme(state.theme);
      const picked = pickFixture({
        templates: templatesRef.current ?? [],
        templateId: state.templateId,
        fixtureName: state.fixtureName,
      });
      if (picked) {
        setSelected({ id: picked.template.id, fixture: picked.fixture.name });
        setCurrentProps(propsOrFixture({ override: props, requestedId: state.templateId, picked }));
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const nav = (
    <>
      <StudioTopBar
        view={view}
        onViewChange={setView}
        previewScheme={previewScheme}
        onPreviewSchemeChange={setPreviewScheme}
      />
      <StudioGuide />
    </>
  );

  if (failure || !templates) {
    return (
      <Page nav={nav}>
        {failure ? (
          <Callout tone="error" title="The mail room could not load the templates">
            {failure}
          </Callout>
        ) : (
          <Text tone="secondary">Loading templates…</Text>
        )}
      </Page>
    );
  }

  if (view === "review") return <DigestReviewView nav={nav} previewDark={previewDark} />;

  return (
    <InspectView
      nav={nav}
      templates={inspectTemplates}
      selected={selected}
      currentProps={currentProps}
      onPropsChange={setCurrentProps}
      onSelect={choose}
      previewDark={previewDark}
      width={width}
      onWidthChange={setWidth}
    />
  );
};

type Picked = { template: TemplateSummary; fixture: TemplateSummary["fixtures"][number] };

/** The named template and fixture, falling back to the first of each when a name misses. */
function pickFixture({
  templates,
  templateId,
  fixtureName,
}: {
  templates: readonly TemplateSummary[];
  templateId: string | null | undefined;
  fixtureName: string | null | undefined;
}): Picked | undefined {
  const template = templates.find((entry) => entry.id === templateId) ?? templates[0];
  const fixture =
    template?.fixtures.find((entry) => entry.name === fixtureName) ?? template?.fixtures[0];
  return template && fixture ? { template, fixture } : undefined;
}

/** A link's edited props when it carries any, else the picked fixture's own. */
/** A link's props belong to the template it names; a fallback template keeps its own fixture. */
function propsOrFixture({
  override,
  requestedId,
  picked,
}: {
  override: unknown;
  requestedId: string | null;
  picked: Picked;
}): unknown {
  return override !== undefined && picked.template.id === requestedId
    ? override
    : picked.fixture.props;
}

/**
 * Address-bar sync: template/fixture/view changes are places worth a back button entry; width,
 * theme and prop edits are preferences that replace the current entry instead.
 */
function useAddressBarSync({
  view,
  selected,
  width,
  previewScheme,
  currentProps,
  suppressNextPush,
}: {
  view: View;
  selected: { id: string; fixture: string } | null;
  width: keyof typeof WIDTHS;
  previewScheme: PreviewScheme;
  currentProps: unknown;
  /** Set by the back button, so the entry it lands on is replaced rather than pushed. */
  suppressNextPush: { current: boolean };
}): void {
  const historyReady = useRef(false);

  useEffect(() => {
    if (!selected) return;
    const search = buildSearch({
      view,
      templateId: selected.id,
      fixtureName: selected.fixture,
      width,
      theme: previewScheme,
    });
    const hash = encodePropsFragment(currentProps);
    if (!historyReady.current) {
      historyReady.current = true;
      window.history.replaceState(null, "", `${search}${hash}`);
      return;
    }
    if (suppressNextPush.current) {
      suppressNextPush.current = false;
      window.history.replaceState(null, "", `${search}${hash}`);
      return;
    }
    window.history.pushState(null, "", `${search}${hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selected?.id, selected?.fixture]);

  useEffect(() => {
    if (!selected || !historyReady.current) return;
    const search = buildSearch({
      view,
      templateId: selected.id,
      fixtureName: selected.fixture,
      width,
      theme: previewScheme,
    });
    const hash = encodePropsFragment(currentProps);
    window.history.replaceState(null, "", `${search}${hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, previewScheme, currentProps]);
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Whether the studio, and so every mail frame, is dark: "system" follows the OS live. */
function useResolvedDark({ scheme }: { scheme: PreviewScheme }): boolean {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return scheme === "system" ? systemDark : scheme === "dark";
}

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "review", label: "Weekly digests" },
  { value: "inspect", label: "All other emails" },
];

/** The kit's ThemeToggle, but bound to the address bar's `theme` rather than localStorage. */
const SCHEME_OPTIONS: { value: PreviewScheme; label: string; icon: JSX.Element }[] = [
  { value: "system", label: "System theme", icon: <IconMonitor /> },
  { value: "light", label: "Light theme", icon: <IconSun /> },
  { value: "dark", label: "Dark theme", icon: <IconMoon /> },
];

function StudioTopBar({
  view,
  onViewChange,
  previewScheme,
  onPreviewSchemeChange,
}: {
  view: View;
  onViewChange: (view: View) => void;
  previewScheme: PreviewScheme;
  onPreviewSchemeChange: (scheme: PreviewScheme) => void;
}): JSX.Element {
  const chrome = useMemo(() => consoleLinks({ location: window.location }), []);
  return (
    <TopBar
      name="Mail room"
      slug={chrome.slug}
      homeHref={chrome.homeHref}
      links={chrome.links}
      themeToggle={false}
      actions={
        <>
          <SegmentedControl
            label="View"
            size="sm"
            options={VIEW_OPTIONS}
            value={view}
            onChange={onViewChange}
          />
          <SegmentedControl
            label="Theme"
            size="sm"
            iconOnly
            options={SCHEME_OPTIONS}
            value={previewScheme}
            onChange={onPreviewSchemeChange}
          />
        </>
      }
    />
  );
}

const GUIDE_DISMISSED_KEY = "mailroom.guide.dismissed";

/** Storage can throw (private windows, blocked cookies); the guide then just shows again. */
const readGuideDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(GUIDE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
};

/** A short "how to use this" note above both tabs, hidden for good once dismissed. */
function StudioGuide(): JSX.Element | null {
  const [dismissed, setDismissed] = useState(readGuideDismissed);
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(GUIDE_DISMISSED_KEY, "1");
    } catch {
      // Hidden for this visit only.
    }
  };
  return (
    <div className="mailroom-guide">
      <Callout title="How to use this">
        <Stack gap={2}>
          <Text as="p">
            Weekly digests shows each digest as it would arrive today, with who gets it, in the
            order they are tried. All other emails lists every other email with sample data: search
            it, step through it with the left and right arrow keys, and switch Desktop or Mobile and
            HTML or Text above the preview.
          </Text>
          <div>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Got it, hide this
            </Button>
          </div>
        </Stack>
      </Callout>
    </div>
  );
}

const mount = document.getElementById("studio");
if (mount) {
  applyThemeChoice({ choice: initialUrl.theme });
  createRoot(mount).render(
    <StrictMode>
      <Studio />
    </StrictMode>,
  );
}
