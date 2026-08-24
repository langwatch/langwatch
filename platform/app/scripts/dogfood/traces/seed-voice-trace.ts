/**
 * Seed one voice-agent trace with audio you can actually play.
 *
 * Local voice fixtures are only useful while their bytes exist: a stored
 * object minted in another worktree points at a storage root that is gone, so
 * every player in the drawer is dead on arrival. This mints fresh bytes under
 * THIS environment's storage root and a trace that references them.
 *
 * What it does, in order:
 *   1. Synthesizes two short tones as raw pcm16 (the shape a realtime voice
 *      agent streams): one for the caller, one for the agent's reply.
 *   2. Builds the span a voice agent emits: `langwatch.input` carrying the
 *      whole transcript (the caller's message AND the agent's, which is how
 *      the two-players-under-INPUT report was found) and `langwatch.output`
 *      carrying the reply.
 *   3. Runs the real ingestion media extraction over it, so the bytes land in
 *      the object store (WAV-wrapped at store time) with their stored_objects
 *      rows, and the parts become /api/files references.
 *   4. POSTs the rewritten span to the running app as OTLP.
 *
 * Usage (from platform/app, .env supplies the database, ClickHouse and
 * storage root the app itself uses):
 *
 *   npx tsx --env-file=.env scripts/dogfood/traces/seed-voice-trace.ts \
 *     --project <project-slug> --endpoint http://localhost:5560
 *
 * Args (all optional):
 *   --project   project slug to seed into; defaults to LW_PROJECT_SLUG, then
 *               to the only project in the database
 *   --endpoint  app origin to POST to (default LW_ENDPOINT, then :5560)
 *   --api-key   ingestion key (default: the project's own key)
 */

import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { maybeExtractSpanMedia } from "~/server/app-layer/traces/edge-media-extraction";
import { prisma } from "~/server/db";
import type { RecordSpanCommandData } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/otlp";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { wrapRawPcmToWav } from "~/shared/audio/pcmToWav";

/** Raw pcm16 is mono 16-bit at 24 kHz, the rate the WAV wrapper writes. */
const PCM16_SAMPLE_RATE = 24_000;

interface Args {
  project: string;
  endpoint: string;
  apiKey: string;
}

function parseArgs(argv: string[]): Args {
  let project = process.env.LW_PROJECT_SLUG ?? "";
  let endpoint = process.env.LW_ENDPOINT ?? "http://localhost:5560";
  let apiKey = process.env.LW_API_KEY ?? "";
  // biome-ignore lint/style/useForOf: flag parser advances the index (argv[++i]) to consume a value; for...of has no index to advance.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") project = argv[++i] ?? "";
    if (argv[i] === "--endpoint") endpoint = argv[++i] ?? "";
    if (argv[i] === "--api-key") apiKey = argv[++i] ?? "";
  }
  return { project, endpoint, apiKey };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * The POST carries a project's ingestion key, and the bytes are written
 * straight to whatever store this environment points at. Both are fine
 * locally and neither is fine anywhere else, so refuse to leave the machine.
 */
function assertLocalEndpoint(endpoint: string): void {
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    throw new Error(`--endpoint is not a URL: ${endpoint}`);
  }
  const isLocal =
    LOCAL_HOSTS.has(hostname) || hostname.endsWith(".langwatch.localhost");
  if (!isLocal) {
    throw new Error(
      `refusing to seed ${hostname}: this script only runs against a local app`,
    );
  }
}

/**
 * A short tone as raw pcm16 samples. Real audio rather than noise, so the
 * player has something recognizable to play and the two clips are told apart
 * by ear.
 */
function tonePcm16({ hz, seconds }: { hz: number; seconds: number }): Buffer {
  const sampleCount = Math.floor(PCM16_SAMPLE_RATE * seconds);
  const bytes = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    // Fade the last tenth of a second out so the clip does not end on a click.
    const remaining = (sampleCount - i) / PCM16_SAMPLE_RATE;
    const gain = 0.3 * Math.min(1, remaining * 10);
    const sample = Math.sin((2 * Math.PI * hz * i) / PCM16_SAMPLE_RATE) * gain;
    bytes.writeInt16LE(Math.round(sample * 0x7fff), i * 2);
  }
  return bytes;
}

function hex(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

function attr(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

/** One message of the transcript, with its text and its recording inline. */
function voiceMessage({
  role,
  text,
  audio,
}: {
  role: "user" | "assistant";
  text: string;
  audio: Buffer;
}) {
  return {
    role,
    content: [
      { type: "text", text },
      {
        type: "input_audio",
        input_audio: {
          data: audio.toString("base64"),
          mimeType: "audio/pcm16",
        },
      },
    ],
  };
}

/**
 * The audio is only worth seeding if its bytes can be written. On a local
 * filesystem root that is the failure worth catching early: the default root
 * belongs to root, so extraction dies several layers down with an mkdir error
 * that names neither the setting to change nor the seed that asked for it.
 */
async function assertWritableStorageRoot(projectId: string) {
  const destination = await resolveProjectStorageDestination(projectId);
  if (destination.kind !== "file") return;

  try {
    await mkdir(destination.root, { recursive: true });
    await access(destination.root, constants.W_OK);
  } catch {
    throw new Error(
      `storage root ${destination.root} is not writable. Set LANGWATCH_LOCAL_STORAGE_PATH in .env to a directory you own, then re-run. The app reads the same setting, so the seeded audio stays playable only while that directory does.`,
    );
  }
}

async function resolveProject(slug: string) {
  if (slug) {
    const project = await prisma.project.findFirst({
      where: { slug },
      select: { id: true, slug: true, name: true, apiKey: true },
    });
    if (!project) throw new Error(`no project with slug "${slug}"`);
    return project;
  }

  const projects = await prisma.project.findMany({
    select: { id: true, slug: true, name: true, apiKey: true },
    orderBy: { createdAt: "asc" },
    take: 25,
  });
  if (projects.length === 0) {
    throw new Error("no projects in this database: sign up in the app first");
  }
  if (projects.length > 1) {
    const slugs = projects.map((p) => p.slug).join(", ");
    throw new Error(`several projects here, pass --project <slug>: ${slugs}`);
  }
  return projects[0]!;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertLocalEndpoint(args.endpoint);

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is unset: run this with `npx tsx --env-file=.env` from platform/app",
    );
  }

  const project = await resolveProject(args.project);
  await assertWritableStorageRoot(project.id);
  const apiKey = args.apiKey || project.apiKey;
  if (!apiKey) {
    throw new Error(`project ${project.slug} has no api key; pass --api-key`);
  }

  const spoken = tonePcm16({ hz: 440, seconds: 1.2 });
  const reply = tonePcm16({ hz: 660, seconds: 1.6 });

  const traceId = hex(16);
  const spanId = hex(8);
  const threadId = `voice-thread-${hex(4)}`;
  const startedAt = Date.now() - 5_000;
  const startNs = BigInt(startedAt) * 1_000_000n;
  const endNs = startNs + 3_400_000_000n;

  const transcript = [
    voiceMessage({
      role: "user",
      text: "Hi, this is ACME Freight. Can you check on shipment 4417?",
      audio: spoken,
    }),
    voiceMessage({
      role: "assistant",
      text: "Shipment 4417 left the depot this morning and arrives tomorrow.",
      audio: reply,
    }),
  ];

  const span = {
    traceId,
    spanId,
    name: "voice turn",
    kind: 1,
    startTimeUnixNano: startNs.toString(),
    endTimeUnixNano: endNs.toString(),
    attributes: [
      attr("langwatch.span.type", "llm"),
      attr("langwatch.input", JSON.stringify(transcript)),
      attr("langwatch.output", JSON.stringify([transcript[1]])),
      attr("gen_ai.system", "openai"),
      attr("gen_ai.request.model", "gpt-4o-realtime-preview"),
      attr("gen_ai.conversation.id", threadId),
    ],
    events: [],
    links: [],
    status: { code: 1 },
  };

  // The real ingestion hook: same call the collector makes, so the bytes are
  // stored and the parts rewritten exactly as they are in production.
  const extracted = await maybeExtractSpanMedia({
    data: {
      tenantId: project.id,
      span: span as unknown as OtlpSpan,
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
      occurredAt: startedAt,
    } as RecordSpanCommandData,
    deps: {
      // The seeder's whole point is playable stored audio, so it does not ask
      // the flag or the privacy policy whether to externalize; it always does.
      isEnabled: async () => true,
      hasContentDropRules: async () => false,
    },
    logger: {
      info: (context, msg) => console.log(msg, context),
      warn: (context, msg) => console.warn(msg, context),
    },
  });

  const payload = JSON.stringify(extracted.span);
  if (payload.includes(spoken.toString("base64"))) {
    throw new Error(
      "media extraction did not externalize the audio: check the storage root and ClickHouse in .env",
    );
  }
  const references = [...payload.matchAll(/\/api\/files\/[\w-]+\/[\w-]+/g)].map(
    (match) => match[0],
  );

  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr("service.name", "acme-voice-agent"),
            attr("service.version", "1.0.0"),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "@langwatch/dogfood-voice-trace", version: "1.0.0" },
            spans: [extracted.span],
          },
        ],
      },
    ],
  };

  const url = `${args.endpoint.replace(/\/$/, "")}/api/otel/v1/traces`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${url} -> ${response.status} ${text}`);
  }

  const wavBytes =
    wrapRawPcmToWav(new Uint8Array(spoken), "pcm16")?.length ?? 0;
  console.log(`POST ${url} -> ${response.status} ${text}`);
  console.log(`project     ${project.name} (${project.slug})`);
  console.log(`stored      ${[...new Set(references)].join(", ")}`);
  console.log(
    `caller clip ${wavBytes} bytes of WAV at ${PCM16_SAMPLE_RATE} Hz`,
  );
  console.log(
    `\nTrace (give the fold a few seconds):\n${args.endpoint.replace(/\/$/, "")}/${project.slug}/traces?drawer.open=traceV2Details&drawer.traceId=${traceId}&drawer.t=${startedAt}`,
  );
}

main()
  .then(() => 0)
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  })
  .then(async (code) => {
    await prisma.$disconnect();
    // Importing the ingestion path brings a Redis connection with it, which
    // holds the event loop open long after the seeding is done.
    process.exit(code);
  });
