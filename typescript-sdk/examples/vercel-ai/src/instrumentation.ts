import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({
    serviceName: 'vercel-ai-sdk-example',
    // Note: LangWatch SDK automatically sets up the trace exporter,
    // so no manual configuration is needed here
  });
}
