"""
Example: Running LangWatch alongside another OTel-based SDK.

This simulates a real-world scenario where another SDK (e.g. an APM)
has already initialized a global TracerProvider. LangWatch uses a
dedicated provider so both SDKs operate independently.

Run:
  LANGWATCH_API_KEY=your-key OPENAI_API_KEY=your-key python otel_provider_isolation.py

Expected: The LLM call appears in your LangWatch dashboard. The
"external" SDK's spans print to the console. No cross-contamination.
"""

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter
from opentelemetry import trace

# ── Step 1: Simulate another OTel SDK initializing first ────────────
# In production this would be Sentry, Datadog, New Relic, etc.
external_provider = TracerProvider()
external_provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(external_provider)
print("[External SDK] Global TracerProvider registered.\n")

# ── Step 2: Initialize LangWatch with a dedicated provider ──────────
import langwatch
from openai import OpenAI

langwatch_provider = TracerProvider()
langwatch.setup(tracer_provider=langwatch_provider)
print("[LangWatch] Using dedicated provider (global untouched).\n")

client = OpenAI()


# ── Step 3: Make an LLM call — should appear in LangWatch ──────────
@langwatch.trace(name="isolated-llm-call")
def chat(user_message: str):
    langwatch.get_current_trace().autotrack_openai_calls(client)

    response = client.chat.completions.create(
        model="gpt-4.1-nano",
        messages=[{"role": "user", "content": user_message}],
    )
    return response.choices[0].message.content


# ── Step 4: Also create an app-level span on the external provider ──
# This should print to console (external SDK) but NOT appear in LangWatch.
external_tracer = trace.get_tracer("external-app")

with external_tracer.start_as_current_span("app-request"):
    print("[App] Starting request...\n")
    reply = chat("What is OpenTelemetry in one sentence?")
    print(f"[LLM Response] {reply}\n")

external_provider.shutdown()
print("\n[Done] Check your LangWatch dashboard for the LLM trace.")
print("The 'app-request' span should only appear in console (external SDK), not LangWatch.")
