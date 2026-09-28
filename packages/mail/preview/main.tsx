import "@langwatch/design-system-internal/styles.css";
import "./app.css";
import {
  applyThemeChoice,
  Callout,
  IconMonitor,
  IconMoon,
  IconSun,
  Page,
  SegmentedControl,
  Text,
  TopBar,
} from "@langwatch/design-system-internal";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";

import { GalleryView, type Density } from "./gallery-view.tsx";
import { InspectView } from "./inspect-view.tsx";
import {
  galleryResponseSchema,
  templatesResponseSchema,
  type GalleryEntry,
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

  const [everyFixture, setEveryFixture] = useState(initialUrl.everyFixture);
  const [width, setWidth] = useState<keyof typeof WIDTHS>(initialUrl.width);
  const [density, setDensity] = useState<Density>(initialUrl.density);

  useEffect(() => {
    applyThemeChoice({ choice: previewScheme });
  }, [previewScheme]);

  useEffect(() => {
    fetch("/__templates")
      .then((response) => response.json())
      .then((json: unknown) => {
        const body = templatesResponseSchema.parse(json);
        if ("error" in body) {
          setFailure(body.error);
          return;
        }
        setTemplates(body);
        const picked = pickFixture({
          templates: body,
          templateId: initialUrl.templateId,
          fixtureName: initialUrl.fixtureName,
        });
        if (picked) {
          setSelected({ id: picked.template.id, fixture: picked.fixture.name });
          setCurrentProps(
            initialPropsOverride !== undefined ? initialPropsOverride : picked.fixture.props,
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

  const openInInspect = useCallback(
    (templateId: string, fixtureName: string) => {
      choose(templateId, fixtureName);
      setView("inspect");
    },
    [choose],
  );

  const inspectTemplates = useMemo(() => templates ?? [], [templates]);

  const suppressNextPush = useRef(false);
  useAddressBarSync({
    view,
    selected,
    width,
    density,
    previewScheme,
    everyFixture,
    currentProps,
    suppressNextPush,
  });
  const { galleryEntries, galleryFailure } = useGalleryEntries({ view, everyFixture });

  useEffect(() => {
    const onPopState = () => {
      const state = parseUrlState(window.location.search);
      const props = decodePropsFragment(window.location.hash);
      suppressNextPush.current = true;
      setView(state.view);
      setWidth(state.width);
      setDensity(state.density);
      setPreviewScheme(state.theme);
      setEveryFixture(state.everyFixture);
      const picked = pickFixture({
        templates: templatesRef.current ?? [],
        templateId: state.templateId,
        fixtureName: state.fixtureName,
      });
      if (picked) {
        setSelected({ id: picked.template.id, fixture: picked.fixture.name });
        setCurrentProps(props !== undefined ? props : picked.fixture.props);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const nav = (
    <StudioTopBar
      view={view}
      onViewChange={setView}
      previewScheme={previewScheme}
      onPreviewSchemeChange={setPreviewScheme}
    />
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

  return view === "inspect" ? (
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
  ) : (
    <GalleryView
      nav={nav}
      entries={galleryEntries}
      failure={galleryFailure}
      everyFixture={everyFixture}
      onEveryFixtureChange={setEveryFixture}
      width={width}
      onWidthChange={setWidth}
      density={density}
      onDensityChange={setDensity}
      previewDark={previewDark}
      onOpen={openInInspect}
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

/** Every template's rendered fixtures while the gallery is open, refetched when the set changes. */
function useGalleryEntries({ view, everyFixture }: { view: View; everyFixture: boolean }): {
  galleryEntries: GalleryEntry[] | null;
  galleryFailure: string | null;
} {
  const [galleryEntries, setGalleryEntries] = useState<GalleryEntry[] | null>(null);
  const [galleryFailure, setGalleryFailure] = useState<string | null>(null);

  useEffect(() => {
    if (view !== "gallery") return;
    setGalleryEntries(null);
    setGalleryFailure(null);
    const controller = new AbortController();
    fetch(`/__gallery${everyFixture ? "?fixtures=all" : ""}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((json: unknown) => {
        const body = galleryResponseSchema.parse(json);
        if ("error" in body) {
          setGalleryFailure(body.error);
          return;
        }
        setGalleryEntries(body);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setGalleryFailure(String(error));
      });
    return () => controller.abort();
  }, [view, everyFixture]);

  return { galleryEntries, galleryFailure };
}

/**
 * Address-bar sync: template/fixture/view changes are places worth a back button entry; width,
 * density, theme and prop edits are preferences that replace the current entry instead.
 */
function useAddressBarSync({
  view,
  selected,
  width,
  density,
  previewScheme,
  everyFixture,
  currentProps,
  suppressNextPush,
}: {
  view: View;
  selected: { id: string; fixture: string } | null;
  width: keyof typeof WIDTHS;
  density: Density;
  previewScheme: PreviewScheme;
  everyFixture: boolean;
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
      density,
      theme: previewScheme,
      everyFixture,
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
      density,
      theme: previewScheme,
      everyFixture,
    });
    const hash = encodePropsFragment(currentProps);
    window.history.replaceState(null, "", `${search}${hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, density, previewScheme, everyFixture, currentProps]);
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
  { value: "inspect", label: "Inspect" },
  { value: "gallery", label: "Gallery" },
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
  return (
    <TopBar
      name="Mail room"
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

const mount = document.getElementById("studio");
if (mount) {
  applyThemeChoice({ choice: initialUrl.theme });
  createRoot(mount).render(
    <StrictMode>
      <Studio />
    </StrictMode>,
  );
}
