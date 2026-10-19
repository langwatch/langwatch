/**
 * Where the studio reads its renders: Vite's live renderer under `dev`, or the
 * files `build:studio` rendered from each fixture, which haven serves statically
 * on the mail-room lane. The build marks its page with this meta tag.
 */
export const isStaticStudio =
  typeof document !== "undefined" &&
  document.querySelector('meta[name="mail-studio"][content="static"]') !== null;

export const STATIC_STUDIO_META = '<meta name="mail-studio" content="static" />';

export const templatesUrl = (): string => (isStaticStudio ? "/__templates.json" : "/__templates");

export const galleryUrl = ({ everyFixture }: { everyFixture: boolean }): string => {
  if (isStaticStudio) return everyFixture ? "/__gallery-all.json" : "/__gallery.json";
  return `/__gallery${everyFixture ? "?fixtures=all" : ""}`;
};

/** A built studio has one render per fixture, so it is addressed by the fixture's position. */
export const fetchRender = ({
  id,
  fixtureIndex,
  props,
  signal,
}: {
  id: string;
  fixtureIndex: number;
  props: unknown;
  signal: AbortSignal;
}): Promise<Response> =>
  isStaticStudio
    ? fetch(`/__render/${encodeURIComponent(id)}/${fixtureIndex}.json`, { signal })
    : fetch("/__render", { method: "POST", body: JSON.stringify({ id, props }), signal });

export const documentUrl = ({
  id,
  fixtureIndex,
  props,
}: {
  id: string;
  fixtureIndex: number;
  props: unknown;
}): string =>
  isStaticStudio
    ? `/__document/${encodeURIComponent(id)}/${fixtureIndex}.html`
    : `/__document?id=${encodeURIComponent(id)}&props=${encodeURIComponent(JSON.stringify(props))}`;
