import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  encodeVideo,
  optimisePageVideos,
  pageVideos,
  rewritePageVideos,
  videoToolchain,
  type PublishedVideo,
} from "../video-variants.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "docs-video-variants-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const published: PublishedVideo = {
  sources: [
    { path: "/media/videos/clip.aaaaaaaaaaaa.webm", type: 'video/webm; codecs="av01.0.08M.08"' },
    { path: "/media/videos/clip.bbbbbbbbbbbb.mp4", type: 'video/mp4; codecs="avc1.640028"' },
  ],
  poster: "/media/videos/clip-poster.cccccccccccc.webp",
  width: 1680,
  height: 1050,
};
const videos = new Map([
  ["/media/videos/clip.webm", published],
  ["/media/videos/clip.mp4", published],
]);
const SOURCES =
  '<source type="video/webm; codecs=&quot;av01.0.08M.08&quot;" src="/docs/media/videos/clip.aaaaaaaaaaaa.webm"/><source type="video/mp4; codecs=&quot;avc1.640028&quot;" src="/docs/media/videos/clip.bbbbbbbbbbbb.mp4"/>';

describe("rewriting a page's videos", () => {
  /** @scenario "Serve videos as small web encodings with a poster" */
  it("offers the WebM and MP4 with a generated poster and waits for a play", () => {
    const html = `<p>Intro</p><video playsInline="" preload="metadata" src="/docs/media/videos/clip.webm" style="width:100%" controls="" muted="" width="100%"></video>`;
    expect(pageVideos({ html, basePath: "/docs" })).toEqual([["/media/videos/clip.webm"]]);
    expect(rewritePageVideos({ html, videos, basePath: "/docs" })).toBe(
      `<p>Intro</p><video playsInline="" preload="none" style="width:100%" controls="" muted="" width="1680" poster="/docs/media/videos/clip-poster.cccccccccccc.webp" height="1050">${SOURCES}</video>`,
    );
  });

  /** @scenario "Serve videos as small web encodings with a poster" */
  it("replaces authored sources, keeps an authored poster, size and fallback link", () => {
    const html = `<video data-docs-clip="true" width="2400" height="1448" poster="/docs/media/posters/clip.webp" preload="none"><source type="video/webm" src="/docs/media/videos/clip.webm"/><source type="video/mp4" src="/docs/media/videos/clip.mp4"/><a href="/docs/media/videos/clip.mp4">Clip</a></video>`;
    expect(rewritePageVideos({ html, videos, basePath: "/docs" })).toBe(
      `<video data-docs-clip="true" width="2400" height="1448" poster="/docs/media/posters/clip.webp" preload="none">${SOURCES}<a href="/docs/media/videos/clip.mp4">Clip</a></video>`,
    );
  });

  /** @scenario "Serve videos as small web encodings with a poster" */
  it("leaves the tour's own poster alone and autoplays only a muted video", () => {
    const tour = `<video data-docs-tour="" preload="none" muted="" autoplay=""><source src="/media/videos/clip.webm"/></video>`;
    const loud = `<video autoplay="" src="/media/videos/clip.mp4"></video>`;
    const rewritten = rewritePageVideos({ html: tour + loud, videos, basePath: "" });
    expect(rewritten).toContain(
      '<video data-docs-tour="" preload="none" muted="" autoplay="" width="1680" height="1050">',
    );
    expect(rewritten).not.toContain('data-docs-tour="" preload="none" muted="" autoplay="" poster');
    expect(rewritten).toContain(
      '<video poster="/media/videos/clip-poster.cccccccccccc.webp" preload="none" width="1680" height="1050">',
    );
  });

  /** @scenario "Serve videos as small web encodings with a poster" */
  it("encodes each video once from its largest source, and leaves it as authored without ffmpeg", async () => {
    mkdirSync(path.join(root, "media/videos"), { recursive: true });
    writeFileSync(path.join(root, "media/videos/clip.webm"), "video");
    writeFileSync(path.join(root, "media/videos/clip.mp4"), "larger video");
    const html =
      '<video><source src="/media/videos/clip.webm"/><source src="/media/videos/clip.mp4"/></video><video src="/media/videos/clip.mp4"></video>';
    const result = await optimisePageVideos({
      pages: new Map([["a/index.html", html]]),
      docsRoot: root,
      basePath: "",
      cacheDir: null,
      toolchain: null,
    });
    expect(result.pages.get("a/index.html")).toBe(html);
    expect(result.files.size).toBe(0);
    expect(result.aliases.size).toBe(0);
    expect(result.unencoded).toEqual(["/media/videos/clip.mp4"]);
  });
});

const toolchain = await videoToolchain();

describe.skipIf(!toolchain)("encoding a video with ffmpeg", () => {
  /** @scenario "Serve videos as small web encodings with a poster" */
  it("encodes a silent WebM and MP4 no wider than twice the column, cached by content", async () => {
    const source = path.join(root, "media/videos/wide.mp4");
    mkdirSync(path.dirname(source), { recursive: true });
    execFileSync("ffmpeg", [
      ...["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=60:duration=1"],
      ...["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", source],
    ]);
    const cacheDir = path.join(root, "cache");
    const encoded = await encodeVideo({ file: source, cacheDir, toolchain });
    expect(encoded).not.toBeNull();
    expect(encoded?.width).toBe(1680);
    expect(Math.abs((encoded?.height ?? 0) - 945)).toBeLessThanOrEqual(1);
    expect(encoded?.webm).toMatch(/^video\/webm; codecs="(av01\.|vp9)/);
    expect(encoded?.mp4).toMatch(/^video\/mp4; codecs="avc1\.64/);
    expect((await sharp(encoded?.files.poster).metadata()).format).toBe("webp");
    for (const name of ["video.webm", "video.mp4"]) {
      const streams = execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,r_frame_rate",
          "-of",
          "csv=p=0",
          path.join(cacheDir, readdirSync(cacheDir)[0] ?? "", name),
        ],
        { encoding: "utf8" },
      );
      expect(streams.trim().split("\n")).toEqual(["video,30/1"]);
    }
    const again = await encodeVideo({ file: source, cacheDir, toolchain: null });
    expect(again?.files.webm.equals(encoded?.files.webm ?? Buffer.alloc(0))).toBe(true);

    const page = (poster: string) => `<video${poster} src="/media/videos/wide.mp4"></video>`;
    const publish = async (html: string) =>
      [
        ...(
          await optimisePageVideos({
            pages: new Map([["a/index.html", html]]),
            docsRoot: root,
            basePath: "",
            cacheDir,
            toolchain: null,
          })
        ).files.keys(),
      ].map((name) => name.replace(/\.[0-9a-f]{12}\./, ".<hash>."));
    expect(await publish(page(""))).toEqual([
      "media/videos/wide.<hash>.webm",
      "media/videos/wide.<hash>.mp4",
      "media/videos/wide-poster.<hash>.webp",
    ]);
    expect(await publish(page(' poster="/media/posters/wide.webp"'))).toEqual([
      "media/videos/wide.<hash>.webm",
      "media/videos/wide.<hash>.mp4",
    ]);
  }, 120_000);
});
