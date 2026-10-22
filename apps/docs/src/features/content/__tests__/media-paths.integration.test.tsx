import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

import { DocsIframe, DocsImage, DocsSource, DocsVideo } from "../ui/media.tsx";

// Suites share modules (isolate: false): drop modules earlier files loaded so this file's imports
// see the mocked base path, and restore the real one for the files after it.
vi.hoisted(() => vi.resetModules());
vi.mock("../../../config.ts", () => ({ docsBasePath: "/docs", isProduction: false }));
afterAll(() => {
  vi.doUnmock("../../../config.ts");
  vi.resetModules();
});

function render({ element }: { element: React.ReactElement }) {
  return renderToStaticMarkup(<DesignSystemTestProvider>{element}</DesignSystemTestProvider>);
}

describe("when the docs are built under a base path", () => {
  /** @scenario "Serve authored media from the docs mount" */
  it("prefixes every local image candidate and keeps descriptors and external URLs", () => {
    const html = render({
      element: (
        <DocsImage
          src="/images/hero-640.webp"
          srcSet="/images/hero-640.webp 640w, /images/hero-1024.webp 1024w, https://cdn.example/a.webp 2x"
          alt="Hero"
        />
      ),
    });
    expect(html).toContain('src="/docs/images/hero-640.webp"');
    expect(html).toContain(
      'srcSet="/docs/images/hero-640.webp 640w, /docs/images/hero-1024.webp 1024w, https://cdn.example/a.webp 2x"',
    );
  });

  /** @scenario "Serve authored media from the docs mount" */
  it("prefixes video sources and posters for clips and authored videos", () => {
    const clip = render({
      element: (
        <DocsVideo data-docs-clip poster="/media/posters/clip.webp">
          <DocsSource src="/media/videos/clip.webm" type="video/webm" />
        </DocsVideo>
      ),
    });
    const authored = render({
      element: <DocsVideo src="/media/videos/add-prompt.mp4" poster="/media/posters/add.jpg" />,
    });
    expect(clip).toContain('poster="/docs/media/posters/clip.webp"');
    expect(clip).toContain('src="/docs/media/videos/clip.webm"');
    expect(authored).toContain('src="/docs/media/videos/add-prompt.mp4"');
    expect(authored).toContain('poster="/docs/media/posters/add.jpg"');
  });

  /** @scenario "Serve authored media from the docs mount" */
  it("prefixes a root-relative embed but leaves an external one alone", () => {
    const local = render({ element: <DocsIframe src="/media/demo.html" title="Demo" /> });
    const external = render({
      element: <DocsIframe src="https://www.youtube.com/embed/x" title="Video" />,
    });
    expect(local).toContain('src="/docs/media/demo.html"');
    expect(external).toContain('src="https://www.youtube.com/embed/x"');
  });
});

describe("when the docs home renders the product tour", () => {
  /** @scenario "Serve the product tour poster at the size of the screen" */
  it("offers AVIF and WebP poster candidates by width and keeps the video's shape", () => {
    const html = render({
      element: (
        <DocsVideo>
          <DocsSource src="/media/videos/introduction.webm" type="video/webm" />
        </DocsVideo>
      ),
    });
    for (const format of ["avif", "webp"]) {
      expect(html).toContain(
        `type="image/${format}" srcSet="/docs/media/posters/introduction-640.${format} 640w, /docs/media/posters/introduction-1024.${format} 1024w, /docs/media/posters/introduction-1664.${format} 1664w"`,
      );
    }
    expect(html).toContain('src="/docs/media/posters/introduction.jpg" width="1664" height="1040"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).not.toContain("poster=");
    expect(html).toContain("aspect-ratio:1664 / 1040");
  });
});
