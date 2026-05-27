/**
 * Running LangWatch alongside another OTel-based SDK.
 *
 * Problem: Both SDKs hook into the same global TracerProvider, so all
 * spans flow to both — LLM traces appear in the other tool and
 * application traces appear in LangWatch.
 *
 * Solution: Use `advanced.attachToExistingProvider` so LangWatch adds
 * its span processors to the existing global provider. The other SDK
 * keeps working as before, and LangWatch receives the spans it needs.
 */

import { setupObservability } from "langwatch/observability/node";

// 1. The other OTel SDK initializes first and sets up the global
//    TracerProvider. (This happens automatically when you import/init
//    the other SDK before LangWatch.)

// 2. Tell LangWatch to attach its processors to the existing provider
//    instead of creating a new one or returning a no-op.
setupObservability({
  langwatch: {
    apiKey: process.env.LANGWATCH_API_KEY,
  },
  advanced: {
    attachToExistingProvider: true,
  },
});

// 3. Use LangWatch tracing as usual — LLM spans are captured and sent
//    to LangWatch, while the other SDK continues to receive its own
//    spans on the same global provider.
