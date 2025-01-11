// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import * as SentryNode from "@sentry/node";

Sentry.init({
  dsn: "https://d2546d7792ca6b4416127840aa7ff323@o4506053863079936.ingest.sentry.io/4506061100154880",

  enabled: process.env.NODE_ENV === "production",

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1,

  // Enable only for /api/collector for now
  tracesSampler: (samplingContext) => {
    const request = samplingContext?.request;

    if (request?.url) {
      if (request.url.includes("/api/collector")) {
        return 1.0; // 100% sampling
      }
      return 0.0; // Disable for all other endpoints
    }

    // Default sampling rate for non-request operations
    return 1.0;
  },

  integrations: [SentryNode.prismaIntegration()],

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
