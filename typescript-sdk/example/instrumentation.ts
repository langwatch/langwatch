import { registerOTel } from '@vercel/otel'
import { LangWatchExporter } from 'langwatch'

export function register() {
  registerOTel({
    serviceName: 'next-app',
    traceExporter: new LangWatchExporter({
      apiKey: process.env.LANGWATCH_API_KEY,
    })
  })
}
