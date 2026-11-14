/**
 * What the signing keys panel says about a key: its setup snippets in the SDKs' real names
 * (docs/integration/<language>/reference.mdx), its masked form and whether a refusal is the
 * Enterprise plan. Snippets read the key from LANGWATCH_SIGNING_KEY, never hold it.
 */
import { readHandledError } from "@langwatch/handled-error/read-handled-error";

export const SIGNING_KEY_ENV = "LANGWATCH_SIGNING_KEY";

export const SIGNING_KEY_LANGUAGES = ["typescript", "python", "go"] as const;
export type SigningKeyLanguage = (typeof SIGNING_KEY_LANGUAGES)[number];

export type SigningKeySnippet = Readonly<{
  language: SigningKeyLanguage;
  label: string;
  filename: string;
  /** The Shiki language the snippet is highlighted as. */
  codeLanguage: string;
  code: string;
}>;

const TYPESCRIPT = `import { setupObservability, withSignedBaggage } from "langwatch/observability/node";

// In the project that makes the call, inside an active span:
await withSignedBaggage(
  { signingKey: process.env.${SIGNING_KEY_ENV}!, entries: { orchestrator: "web" } },
  () => callTheOtherService(),
);

// In the project it calls, copy the tag onto its spans:
setupObservability({ braids: { copyEntries: ["orchestrator"] } });`;

const PYTHON = `import os

import langwatch
from langwatch.braids import signed_baggage

# In the project that makes the call, inside an active span:
with signed_baggage(os.environ["${SIGNING_KEY_ENV}"], {"orchestrator": "web"}):
    call_the_other_service()

# In the project it calls, copy the tag onto its spans:
langwatch.setup(braid_copy_entries=["orchestrator"])`;

const GO = `// In the project that makes the call, inside an active span:
ctx, err := langwatch.SignBaggage(ctx, os.Getenv("${SIGNING_KEY_ENV}"), map[string]string{
	"orchestrator": "web",
})

// In the project it calls, copy the tag onto its spans:
braids, err := langwatch.NewBraidBaggageSpanProcessor("orchestrator")
tp := sdktrace.NewTracerProvider(
	sdktrace.WithSpanProcessor(braids),
	sdktrace.WithBatcher(exporter),
)`;

export const SIGNING_KEY_SNIPPETS: readonly SigningKeySnippet[] = [
  {
    language: "typescript",
    label: "TypeScript",
    filename: "TypeScript",
    codeLanguage: "typescript",
    code: TYPESCRIPT,
  },
  { language: "python", label: "Python", filename: "Python", codeLanguage: "python", code: PYTHON },
  { language: "go", label: "Go", filename: "Go", codeLanguage: "go", code: GO },
];

/** `lwsk_<publicId>_••••<last four>`: enough to tell keys apart, never enough to sign. */
export function maskSigningKey(secret: string): string {
  const cut = secret.lastIndexOf("_");
  if (cut <= 0) return `${"•".repeat(4)}${secret.slice(-4)}`;
  return `${secret.slice(0, cut + 1)}${"•".repeat(4)}${secret.slice(-4)}`;
}

/** A refusal for want of the Enterprise plan: the panel shows the upsell, not a failure. */
export function isEnterprisePlanRefusal(error: unknown): boolean {
  return readHandledError(error)?.code === "enterprise_plan_required";
}
