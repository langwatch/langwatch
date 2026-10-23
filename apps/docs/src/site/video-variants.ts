/* Transcodes every local video the pages play into a small web encoding (AV1 WebM with an H.264
   MP4 fallback, no audio track when the source is silent) with a WebP poster from its first frame,
   and rewrites each `<video>` to offer them. Encodes are cached by source content, so only a new
   or changed video costs an ffmpeg run. Without ffmpeg the videos are published as authored. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";
import { z } from "zod";

import { withBasePath } from "../lib/site-path.ts";
import { hashedName, localMediaPath } from "./hashed-assets.ts";
import { pruneCache, writeAtomically } from "./media-cache.ts";

const run = promisify(execFile);

/* Twice the 840px article column, at most 30 frames a second: screen recordings gain nothing more. */
const MAX_WIDTH = 1680;
const MAX_FPS = 30;
/* Below this peak level an audio track is silence and is dropped. */
const SILENT_DB = -50;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
/* Tried in order: SVT-AV1 is fast and has a screen-content mode; libaom and VP9 are fallbacks for
   an ffmpeg built without it. Settings measured on the docs' recordings: SSIM above 0.99 against
   the source at about 60% of its size; slower presets cost twice the CPU for no smaller file. */
const WEBM_ENCODERS = [
  {
    encoder: "libsvtav1",
    args: ["-c:v", "libsvtav1", "-preset", "8", "-crf", "48", "-g", "300"],
    params: ["-svtav1-params", "scm=1"],
  },
  {
    encoder: "libaom-av1",
    args: ["-c:v", "libaom-av1", "-cpu-used", "6", "-row-mt", "1", "-crf", "40", "-b:v", "0"],
    params: ["-g", "300"],
  },
  {
    encoder: "libvpx-vp9",
    args: ["-c:v", "libvpx-vp9", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1"],
    params: ["-crf", "42", "-b:v", "0", "-g", "300"],
  },
] as const;
const MP4_ARGS = ["-c:v", "libx264", "-preset", "medium", "-crf", "30", "-tune", "animation"];
const SETTINGS = `v1 ${MAX_WIDTH} ${MAX_FPS} ${SILENT_DB} svtav1 p8 crf48 scm1; aom crf40; vp9 crf42; x264 medium crf30 animation; poster webp q76`;

const probeSchema = z.object({
  streams: z
    .array(
      z.looseObject({
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        level: z.number().optional(),
        profile: z.string().optional(),
      }),
    )
    .default([]),
});
const recordSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  webm: z.string().min(1),
  mp4: z.string().min(1),
});

/** One video's web encodings: each source's MIME type with codecs, and its poster. */
export type EncodedVideo = z.infer<typeof recordSchema> & {
  files: { webm: Buffer; mp4: Buffer; poster: Buffer };
};

type Toolchain = { webm: (typeof WEBM_ENCODERS)[number] } | null;

/** The ffmpeg encoders this machine has, or null when ffmpeg or ffprobe is missing. */
export async function videoToolchain(): Promise<Toolchain> {
  try {
    await run("ffprobe", ["-version"]);
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-encoders"], {
      maxBuffer: 4 * 1024 * 1024,
    });
    const webm = WEBM_ENCODERS.find(({ encoder }) => new RegExp(`\\s${encoder}\\s`).test(stdout));
    return webm && /\slibx264\s/.test(stdout) ? { webm } : null;
  } catch {
    return null;
  }
}

async function probe({ file }: { file: string }) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file]);
  return probeSchema.parse(JSON.parse(stdout)).streams;
}

/** Whether the first audio track carries sound; a silent capture's track is dropped. */
async function audible({ file }: { file: string }) {
  const streams = await probe({ file });
  if (!streams.some((stream) => stream.codec_type === "audio")) return false;
  const { stderr } = await run(
    "ffmpeg",
    ["-hide_banner", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const peak = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
  return peak !== undefined && peak !== "-inf" && Number(peak) > SILENT_DB;
}

/** The `type` of a `<source>`: container and codec, so a browser skips what it cannot decode. */
async function sourceType({ file }: { file: string }) {
  const video = (await probe({ file })).find((stream) => stream.codec_type === "video");
  const level = video?.level ?? -1;
  if (video?.codec_name === "av1")
    return `video/webm; codecs="av01.0.${String(level >= 0 ? level : 8).padStart(2, "0")}M.08"`;
  if (video?.codec_name === "vp9") return 'video/webm; codecs="vp9"';
  if (video?.codec_name === "h264") {
    const hex = (level > 0 ? level : 40).toString(16).padStart(2, "0");
    return `video/mp4; codecs="avc1.6400${hex}"`;
  }
  return file.endsWith(".mp4") ? "video/mp4" : "video/webm";
}

async function transcode({
  input,
  toolchain,
  directory,
}: {
  input: string;
  toolchain: NonNullable<Toolchain>;
  directory: string;
}) {
  const scale = `scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos,format=yuv420p`;
  const common = ["-hide_banner", "-v", "error", "-y", "-i", input, "-map", "0:v:0"];
  const shape = ["-vf", scale, "-fpsmax", String(MAX_FPS), "-map_metadata", "-1"];
  const sound = await audible({ file: input });
  const webm = path.join(directory, "video.webm");
  const mp4 = path.join(directory, "video.mp4");
  const poster = path.join(directory, "poster.png");
  await run("ffmpeg", [
    ...common,
    ...(sound ? ["-map", "0:a:0", "-c:a", "libopus", "-b:a", "64k"] : ["-an"]),
    ...shape,
    ...toolchain.webm.args,
    ...toolchain.webm.params,
    webm,
  ]);
  await run("ffmpeg", [
    ...common,
    ...(sound ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "96k"] : ["-an"]),
    ...shape,
    ...MP4_ARGS,
    "-profile:v",
    "high",
    "-movflags",
    "+faststart",
    mp4,
  ]);
  await run("ffmpeg", [...common, "-vf", scale, "-frames:v", "1", "-update", "1", poster]);
  const posterImage = await sharp(poster)
    .webp({ quality: 76, effort: 6, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  return {
    record: {
      width: posterImage.info.width,
      height: posterImage.info.height,
      webm: await sourceType({ file: webm }),
      mp4: await sourceType({ file: mp4 }),
    },
    files: { webm: await readFile(webm), mp4: await readFile(mp4), poster: posterImage.data },
  };
}

const CACHE_FILES = { webm: "video.webm", mp4: "video.mp4", poster: "poster.webp" } as const;

async function readCached({ entry }: { entry: string }): Promise<EncodedVideo | null> {
  try {
    const record = recordSchema.parse(
      JSON.parse(await readFile(path.join(entry, "record.json"), "utf8")),
    );
    const [webm, mp4, poster] = await Promise.all(
      Object.values(CACHE_FILES).map((name) => readFile(path.join(entry, name))),
    );
    if (!webm?.length || !mp4?.length || !poster?.length) return null;
    return { ...record, files: { webm, mp4, poster } };
  } catch {
    return null;
  }
}

/**
 * A video's web encodings, read from `cacheDir` when an earlier build encoded the same bytes with
 * the same settings. Null without an ffmpeg that can encode.
 */
export async function encodeVideo({
  file,
  cacheDir,
  toolchain,
  used,
}: {
  file: string;
  cacheDir: string | null;
  toolchain: Toolchain;
  used?: Set<string>;
}): Promise<EncodedVideo | null> {
  const digest = createHash("sha256")
    .update(SETTINGS)
    .update(await readFile(file))
    .digest("hex")
    .slice(0, 32);
  used?.add(digest);
  const entry = cacheDir ? path.join(cacheDir, digest) : null;
  const hit = entry ? await readCached({ entry }) : null;
  if (hit) return hit;
  if (!toolchain) return null;
  const scratch = await mkdtemp(path.join(os.tmpdir(), "docs-video-"));
  try {
    const encoded = await transcode({ input: file, toolchain, directory: scratch });
    if (entry) {
      for (const [key, name] of Object.entries(CACHE_FILES))
        await writeAtomically({
          file: path.join(entry, name),
          bytes: encoded.files[key as keyof typeof CACHE_FILES],
        });
      await writeAtomically({
        file: path.join(entry, "record.json"),
        bytes: Buffer.from(JSON.stringify(encoded.record)),
      });
    }
    return { ...encoded.record, files: encoded.files };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** A published video: its sources' site paths (without the base path) and types, and its poster. */
export type PublishedVideo = {
  sources: { path: string; type: string }[];
  poster: string;
  width: number;
  height: number;
};

const VIDEO_ELEMENT = /<video\b([^>]*)>([\s\S]*?)<\/video>/gi;
const SOURCE_ELEMENT = /<source\b[^>]*?\/?>/gi;

function attribute({ tag, name }: { tag: string; name: string }) {
  return new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1]?.replaceAll("&amp;", "&") ?? null;
}

function hasAttribute({ tag, name }: { tag: string; name: string }) {
  return new RegExp(`\\s${name}(=|\\s|$)`, "i").test(tag);
}

function setAttribute({ tag, name, value }: { tag: string; name: string; value: string }) {
  const pattern = new RegExp(`\\s${name}="[^"]*"`, "i");
  return pattern.test(tag)
    ? tag.replace(pattern, ` ${name}="${value}"`)
    : `${tag} ${name}="${value}"`;
}

function removeAttribute({ tag, name }: { tag: string; name: string }) {
  return tag.replace(new RegExp(`\\s${name}(="[^"]*")?(?=\\s|$)`, "gi"), "");
}

/** The local video files a `<video>` names, on its own `src` and on its `<source>` children. */
function videoSources({
  attributes,
  children,
  basePath,
}: {
  attributes: string;
  children: string;
  basePath: string;
}) {
  const urls = [attribute({ tag: attributes, name: "src" })];
  for (const [source] of children.matchAll(SOURCE_ELEMENT))
    urls.push(attribute({ tag: source, name: "src" }));
  return urls.flatMap((url) => {
    const sitePath = url ? localMediaPath({ url, basePath }) : null;
    return sitePath && VIDEO.test(sitePath) ? [sitePath] : [];
  });
}

/** The local video site paths each of the page's `<video>` elements plays, one list per video. */
export function pageVideos({ html, basePath }: { html: string; basePath: string }) {
  return [...html.matchAll(VIDEO_ELEMENT)]
    .map(([, attributes = "", children = ""]) => videoSources({ attributes, children, basePath }))
    .filter((sources) => sources.length > 0);
}

/** The best-quality file among a video's authored sources: the largest one present. */
async function encodingInput({ sources, docsRoot }: { sources: string[]; docsRoot: string }) {
  let best: { sitePath: string; file: string; size: number } | null = null;
  for (const sitePath of sources) {
    const file = path.join(docsRoot, sitePath);
    if (!file.startsWith(docsRoot + path.sep) || !existsSync(file)) continue;
    const info = await stat(file);
    if (info.isFile() && info.size > (best?.size ?? -1)) best = { sitePath, file, size: info.size };
  }
  return best;
}

/**
 * Each published `<video>` offering its WebM and MP4, with the generated poster unless one is
 * authored or the tour draws its own (`data-docs-tour`). With a poster it fetches nothing until
 * played; autoplay stays only when muted; an unsized video takes the encoding's size.
 */
export function rewritePageVideos({
  html,
  videos,
  basePath,
}: {
  html: string;
  videos: ReadonlyMap<string, PublishedVideo>;
  basePath: string;
}) {
  const site = (sitePath: string) => withBasePath({ basePath, path: sitePath });
  return html.replace(VIDEO_ELEMENT, (element, attributes: string, children: string) => {
    const found = videoSources({ attributes, children, basePath })
      .map((sitePath) => videos.get(sitePath))
      .find(Boolean);
    if (!found) return element;
    let tag = removeAttribute({ tag: attributes, name: "src" });
    if (!hasAttribute({ tag, name: "poster" }) && !hasAttribute({ tag, name: "data-docs-tour" }))
      tag = setAttribute({ tag, name: "poster", value: site(found.poster) });
    if (hasAttribute({ tag, name: "autoplay" }) && !hasAttribute({ tag, name: "muted" }))
      tag = removeAttribute({ tag, name: "autoplay" });
    if (hasAttribute({ tag, name: "poster" }) && !hasAttribute({ tag, name: "autoplay" }))
      tag = setAttribute({ tag, name: "preload", value: "none" });
    if (!/\sheight="\d+"/.test(tag) || !/\swidth="\d+"/.test(tag)) {
      tag = setAttribute({ tag, name: "width", value: String(found.width) });
      tag = setAttribute({ tag, name: "height", value: String(found.height) });
    }
    const sources = found.sources
      .map(
        (source) =>
          `<source type="${source.type.replaceAll('"', "&quot;")}" src="${site(source.path)}"/>`,
      )
      .join("");
    const rest = children.replace(SOURCE_ELEMENT, (source) =>
      videoSources({ attributes: source, children: "", basePath }).length > 0 ? "" : source,
    );
    return `<video${tag}>${sources}${rest}</video>`;
  });
}

/** Names an encoded video's files by their content beside the authored path and adds them to `files`. */
function publish({
  sitePath,
  encoded,
  files,
}: {
  sitePath: string;
  encoded: EncodedVideo;
  files: Map<string, Buffer>;
}): PublishedVideo {
  const stem = sitePath.slice(1).replace(/\.[^./]+$/, "");
  const webm = hashedName({ name: `${stem}.webm`, bytes: encoded.files.webm });
  const mp4 = hashedName({ name: `${stem}.mp4`, bytes: encoded.files.mp4 });
  const poster = hashedName({ name: `${stem}-poster.webp`, bytes: encoded.files.poster });
  files.set(webm, encoded.files.webm);
  files.set(mp4, encoded.files.mp4);
  files.set(poster, encoded.files.poster);
  return {
    sources: [
      { path: `/${webm}`, type: encoded.webm },
      { path: `/${mp4}`, type: encoded.mp4 },
    ],
    poster: `/${poster}`,
    width: encoded.width,
    height: encoded.height,
  };
}

/**
 * Encodes every local video the pages play and rewrites each page to offer the encodings.
 * Returns the rewritten pages, the files to publish, per authored path the MP4 that replaces it
 * wherever a page or export still links to the original, and the videos left as authored.
 */
export async function optimisePageVideos({
  pages,
  docsRoot,
  basePath,
  cacheDir,
  toolchain,
}: {
  pages: ReadonlyMap<string, string>;
  docsRoot: string;
  basePath: string;
  cacheDir: string | null;
  toolchain?: Toolchain;
}) {
  const chain = toolchain === undefined ? await videoToolchain() : toolchain;
  const groups = [...new Set(pages.values())].flatMap((html) => pageVideos({ html, basePath }));
  const files = new Map<string, Buffer>();
  const aliases = new Map<string, string>();
  const videos = new Map<string, PublishedVideo>();
  const byInput = new Map<string, PublishedVideo | null>();
  const used = new Set<string>();
  const missing: string[] = [];
  for (const sources of groups) {
    const input = await encodingInput({ sources, docsRoot });
    if (!input) continue;
    if (!byInput.has(input.sitePath)) {
      const encoded = await encodeVideo({ file: input.file, cacheDir, toolchain: chain, used });
      if (!encoded) missing.push(input.sitePath);
      byInput.set(
        input.sitePath,
        encoded ? publish({ sitePath: input.sitePath, encoded, files }) : null,
      );
    }
    const published = byInput.get(input.sitePath);
    if (!published) continue;
    for (const sitePath of sources) {
      videos.set(sitePath, published);
      aliases.set(sitePath, published.sources[1]?.path ?? "");
    }
  }
  if (chain) await pruneCache({ directory: cacheDir, keep: used });
  const byHtml = new Map<string, string>();
  const rewritten = new Map<string, string>();
  for (const [target, html] of pages) {
    const page = byHtml.get(html) ?? rewritePageVideos({ html, videos, basePath });
    byHtml.set(html, page);
    rewritten.set(target, page);
  }
  /* A clip with an authored poster, or the tour drawing its own, leaves the generated one unused. */
  const shown = [...new Set(rewritten.values())];
  for (const { poster } of new Set(videos.values()))
    if (!shown.some((html) => html.includes(`"${withBasePath({ basePath, path: poster })}"`)))
      files.delete(poster.slice(1));
  return {
    pages: rewritten,
    files,
    aliases,
    encoded: byInput.size - missing.length,
    unencoded: missing,
  };
}
