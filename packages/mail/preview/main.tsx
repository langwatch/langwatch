import { Box, Flex, Heading } from "@chakra-ui/react";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { useTheme } from "next-themes";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { GalleryView, type Density } from "./gallery-view.tsx";
import { InspectView } from "./inspect-view.tsx";
import {
  type PreviewScheme,
  type GalleryEntry,
  type TemplateSummary,
  WIDTHS,
} from "./studio-shared.ts";
import { buildSearch, decodePropsFragment, encodePropsFragment, parseUrlState } from "./studio-url.ts";
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
  const { resolvedTheme, setTheme } = useTheme();
  const previewDark = resolvedTheme === "dark";

  const [galleryEntries, setGalleryEntries] = useState<GalleryEntry[] | null>(null);
  const [galleryFailure, setGalleryFailure] = useState<string | null>(null);
  const [everyFixture, setEveryFixture] = useState(initialUrl.everyFixture);
  const [width, setWidth] = useState<keyof typeof WIDTHS>(initialUrl.width);
  const [density, setDensity] = useState<Density>(initialUrl.density);

  useEffect(() => {
    setTheme(previewScheme);
  }, [previewScheme, setTheme]);

  useEffect(() => {
    fetch("/__templates")
      .then((response) => response.json())
      .then((body: TemplateSummary[] | { error: string }) => {
        if ("error" in body) {
          setFailure(body.error);
          return;
        }
        setTemplates(body);
        const wanted = initialUrl.templateId
          ? (body.find((entry) => entry.id === initialUrl.templateId) ?? body[0])
          : body[0];
        const fixture = initialUrl.fixtureName
          ? (wanted?.fixtures.find((entry) => entry.name === initialUrl.fixtureName) ??
            wanted?.fixtures[0])
          : wanted?.fixtures[0];
        if (wanted && fixture) {
          setSelected({ id: wanted.id, fixture: fixture.name });
          setCurrentProps(
            initialPropsOverride !== undefined ? initialPropsOverride : fixture.props,
          );
        }
      })
      .catch((error: unknown) => setFailure(String(error)));
  }, []);

  useEffect(() => {
    if (view !== "gallery") return;
    setGalleryEntries(null);
    setGalleryFailure(null);
    const controller = new AbortController();
    fetch(`/__gallery${everyFixture ? "?fixtures=all" : ""}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((body: GalleryEntry[] | { error: string }) => {
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

  // Address-bar sync: template/fixture/view changes are places worth a back
  // button entry; width, density, theme and prop edits are preferences that
  // replace the current entry instead of piling up a new one per keystroke.
  const historyReady = useRef(false);
  const suppressNextPush = useRef(false);

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
      const current = templatesRef.current;
      const template = current?.find((entry) => entry.id === state.templateId) ?? current?.[0];
      const fixture = state.fixtureName
        ? (template?.fixtures.find((entry) => entry.name === state.fixtureName) ??
          template?.fixtures[0])
        : template?.fixtures[0];
      if (template && fixture) {
        setSelected({ id: template.id, fixture: fixture.name });
        setCurrentProps(props !== undefined ? props : fixture.props);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (failure) {
    return (
      <Box padding={6} color="red.700">
        The studio could not load the templates: {failure}
      </Box>
    );
  }
  if (!templates) {
    return (
      <Box padding={6} color="fg.muted">
        Loading templates…
      </Box>
    );
  }

  return (
    <Flex direction="column" height="100vh" bg="bg">
      <Flex
        as="header"
        align="center"
        justify="space-between"
        gap={4}
        paddingX={4}
        paddingY={2}
        borderBottomWidth="1px"
        borderColor="border"
        bg="bg.panel"
        flexWrap="wrap"
      >
        <Heading size="sm">LangWatch mail</Heading>
        <Flex gap={4} align="center" flexWrap="wrap">
          <SegmentedControl
            size="xs"
            items={[
              { value: "inspect", label: "Inspect" },
              { value: "gallery", label: "Gallery" },
            ]}
            value={view}
            onValueChange={(details) => setView(details.value as View)}
          />
          <SegmentedControl
            size="xs"
            items={[
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
            ]}
            value={previewScheme}
            onValueChange={(details) => setPreviewScheme(details.value as PreviewScheme)}
          />
        </Flex>
      </Flex>

      <Box flex="1" minHeight={0}>
        {view === "inspect" ? (
          <InspectView
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
        )}
      </Box>
    </Flex>
  );
};

const mount = document.getElementById("studio");
if (mount) {
  createRoot(mount).render(
    <StrictMode>
      <DesignSystemProvider>
        <Studio />
      </DesignSystemProvider>
    </StrictMode>,
  );
}
