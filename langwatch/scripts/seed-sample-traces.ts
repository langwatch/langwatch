/**
 * Seed sample traces through the real collector.
 *
 * `haven seed --preset demo` runs this after the Prisma seed: it POSTs a small,
 * deterministic set of realistic traces to the running stack's /api/collector,
 * so lists, threads, and dashboards have data the moment the UI opens. Going
 * through the collector (rather than writing ClickHouse directly) exercises the
 * real ingestion pipeline and stays correct as projections evolve.
 *
 * Trace IDs are fixed, so re-running is idempotent — the same traces are
 * upserted, never duplicated.
 *
 * Env:
 *   HAVEN_SEED_ENDPOINT           collector origin (e.g. https://app.<slug>.langwatch.localhost)
 *   HAVEN_SEED_LANGWATCH_API_KEY  the project's ingestion key
 */

const ENDPOINT = process.env.HAVEN_SEED_ENDPOINT ?? "http://localhost:5560";
const API_KEY =
  process.env.HAVEN_SEED_LANGWATCH_API_KEY ?? "sk-lw-local-development-key";

interface SampleTurn {
  user: string;
  assistant: string;
}

interface SampleThread {
  threadId: string;
  userId: string;
  labels: string[];
  turns: SampleTurn[];
}

const THREADS: SampleThread[] = [
  {
    threadId: "demo-thread-billing",
    userId: "demo-user-ines",
    labels: ["support", "billing"],
    turns: [
      {
        user: "Hi — I was charged twice for my Pro subscription this month. Can you help?",
        assistant:
          "I'm sorry about that! I can see two charges on June 28th. One of them is a duplicate from a retried payment — I've flagged it for an automatic refund, which should land in 3–5 business days. You'll get a confirmation email shortly.",
      },
      {
        user: "Great, and will this affect my invoice for accounting?",
        assistant:
          "No — your invoice will show a single Pro subscription charge. The refunded duplicate is issued as a separate credit note, which I've attached to your billing history.",
      },
    ],
  },
  {
    threadId: "demo-thread-onboarding",
    userId: "demo-user-marcus",
    labels: ["product", "onboarding"],
    turns: [
      {
        user: "How do I invite my teammates to the workspace?",
        assistant:
          'Go to Settings → Members and click "Invite". You can paste multiple email addresses at once, and each teammate gets a magic link that adds them straight to your workspace with the role you pick.',
      },
    ],
  },
  {
    threadId: "demo-thread-rag-docs",
    userId: "demo-user-priya",
    labels: ["docs-assistant", "rag"],
    turns: [
      {
        user: "What's the rate limit on the traces endpoint?",
        assistant:
          "The traces ingestion endpoint accepts up to 3,000 requests per minute per project. Batching spans into one request per trace counts as a single request, so batched SDKs rarely hit the limit.",
      },
      {
        user: "And what happens if I exceed it?",
        assistant:
          "You'll receive HTTP 429 with a Retry-After header. The official SDKs back off and retry automatically, so short bursts above the limit are absorbed without losing traces.",
      },
    ],
  },
  {
    threadId: "demo-thread-summarize",
    userId: "demo-user-ines",
    labels: ["summarization"],
    turns: [
      {
        user: "Summarize this incident report: our checkout API returned 500s for 12 minutes after the 14:02 deploy. Rollback at 14:14 restored service. Root cause was a missing env var in the new release.",
        assistant:
          "**Incident summary:** A 14:02 deploy shipped without a required environment variable, causing checkout API 500s for 12 minutes. Rolling back at 14:14 restored service. **Action items:** add the variable to the deploy manifest and gate releases on a config completeness check.",
      },
    ],
  },
  {
    threadId: "demo-thread-translate",
    userId: "demo-user-marcus",
    labels: ["translation"],
    turns: [
      {
        user: 'Translate to Dutch: "Your order has shipped and will arrive within two business days."',
        assistant:
          '"Je bestelling is verzonden en wordt binnen twee werkdagen bezorgd."',
      },
    ],
  },
];

async function post(traceId: string, thread: SampleThread, turn: SampleTurn, finishedAtMs: number): Promise<void> {
  const startedAtMs = finishedAtMs - 1800;
  const payload = {
    trace_id: traceId,
    spans: [
      {
        type: "llm",
        span_id: `${traceId}-llm`,
        name: "chat-completion",
        model: "gpt-5-mini",
        input: {
          type: "chat_messages",
          value: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: turn.user },
          ],
        },
        output: {
          type: "chat_messages",
          value: [{ role: "assistant", content: turn.assistant }],
        },
        metrics: {
          prompt_tokens: Math.ceil(turn.user.length / 4) + 12,
          completion_tokens: Math.ceil(turn.assistant.length / 4),
        },
        timestamps: { started_at: startedAtMs, finished_at: finishedAtMs },
      },
    ],
    metadata: {
      user_id: thread.userId,
      thread_id: thread.threadId,
      labels: [...thread.labels, "demo-seed"],
    },
  };

  const response = await fetch(`${ENDPOINT}/api/collector`, {
    method: "POST",
    headers: {
      "X-Auth-Token": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(
      `POST ${ENDPOINT}/api/collector -> ${response.status}: ${await response.text()}`,
    );
  }
}

async function main() {
  const now = Date.now();
  let sent = 0;
  let turnIndex = 0;
  const totalTurns = THREADS.reduce((n, t) => n + t.turns.length, 0);
  for (const thread of THREADS) {
    for (const [i, turn] of thread.turns.entries()) {
      // Spread the traces over the last few hours, newest last-turn first.
      const finishedAt = now - (totalTurns - turnIndex) * 23 * 60 * 1000;
      await post(`demo-seed-${thread.threadId}-${i + 1}`, thread, turn, finishedAt);
      sent++;
      turnIndex++;
    }
  }
  console.log(`🌱 Seeded ${sent} sample traces into ${ENDPOINT}`);
  console.log(
    "   They flow through the real pipeline — give the workers a few seconds to project them.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
