/**
 * Live-fire dogfood helper — fires a real LLM completion through the
 * local Go gateway (default :5563) using a personal VK secret + prints
 * the result to stdout. Pairs with `seed-personas.ts --mint-vk`.
 *
 * Usage:
 *   pnpm tsx scripts/dogfood/fire-completion.ts \
 *     --vk lw_vk_live_<...> \
 *     --model claude-sonnet-4 \
 *     --prompt "Write a haiku about retrieval-augmented generation."
 *
 * Optional flags:
 *   --base-url <url>   Override gateway base URL (default LW_GATEWAY_BASE_URL
 *                       or http://localhost:5563)
 *   --provider <name>  OpenAI-shape (default) or anthropic
 *   --max-tokens <n>   Default 200
 *
 * The script exits non-zero if the gateway responds with an error so it's
 * safe to chain in a dogfood pipeline (`seed-personas | fire-completion`).
 *
 * Output (stdout, JSON one-line):
 *   { provider, model, content, usage: {input_tokens, output_tokens}, traceId? }
 *
 * Closes the iter28-followup live-fire gap: 'infrastructure proven but
 * not live-fired' becomes 'live-fired + screenshot-able'. After firing
 * one or more completions, the persona's /me/usage and /governance
 * dashboards render real spend instead of empty-state placeholders.
 */
interface Args {
  vk: string;
  model: string;
  prompt: string;
  baseUrl: string;
  provider: "openai" | "anthropic";
  maxTokens: number;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {
    baseUrl: process.env.LW_GATEWAY_BASE_URL ?? "http://localhost:5563",
    provider: "openai",
    maxTokens: 200,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vk") out.vk = argv[++i];
    else if (argv[i] === "--model") out.model = argv[++i];
    else if (argv[i] === "--prompt") out.prompt = argv[++i];
    else if (argv[i] === "--base-url") out.baseUrl = argv[++i];
    else if (argv[i] === "--provider")
      out.provider = argv[++i] as Args["provider"];
    else if (argv[i] === "--max-tokens")
      out.maxTokens = parseInt(argv[++i] ?? "200", 10);
  }
  if (!out.vk) throw new Error("--vk is required (personal VK secret)");
  if (!out.model) throw new Error("--model is required (e.g. claude-sonnet-4)");
  if (!out.prompt) throw new Error("--prompt is required");
  return out as Args;
}

async function fireOpenAi(args: Args) {
  const url = `${args.baseUrl}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.vk}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: [{ role: "user", content: args.prompt }],
      max_tokens: args.maxTokens,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gateway returned ${res.status}: ${text}`);
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const traceId = res.headers.get("x-langwatch-trace-id") ?? null;
  return {
    provider: "openai" as const,
    model: args.model,
    content: body.choices?.[0]?.message?.content ?? "",
    usage: {
      input_tokens: body.usage?.prompt_tokens ?? 0,
      output_tokens: body.usage?.completion_tokens ?? 0,
    },
    traceId,
  };
}

async function fireAnthropic(args: Args) {
  const url = `${args.baseUrl}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.vk}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: args.model,
      messages: [{ role: "user", content: args.prompt }],
      max_tokens: args.maxTokens,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gateway returned ${res.status}: ${text}`);
  }
  const body = (await res.json()) as {
    content?: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const traceId = res.headers.get("x-langwatch-trace-id") ?? null;
  return {
    provider: "anthropic" as const,
    model: args.model,
    content: body.content?.map((c) => c.text ?? "").join("") ?? "",
    usage: {
      input_tokens: body.usage?.input_tokens ?? 0,
      output_tokens: body.usage?.output_tokens ?? 0,
    },
    traceId,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stderr.write(
    `[fire-completion] base=${args.baseUrl} provider=${args.provider} model=${args.model}\n`,
  );
  const result =
    args.provider === "anthropic" ? await fireAnthropic(args) : await fireOpenAi(args);
  process.stdout.write(JSON.stringify(result) + "\n");
}

main().catch((err) => {
  process.stderr.write(`[fire-completion] ERROR: ${err.message}\n`);
  process.exit(1);
});
