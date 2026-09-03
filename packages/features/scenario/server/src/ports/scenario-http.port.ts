/** Response boundary required by serialized HTTP scenario targets. */
export interface ScenarioHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Named egress boundary for an HTTP scenario target.
 *
 * The application composition supplies the SSRF-safe implementation; the
 * scenario server never imports an application fetch helper or weakens its
 * policy with a native-fetch fallback.
 */
export abstract class ScenarioHttpPort {
  abstract fetch(input: {
    url: string;
    init: { method: string; headers: Record<string, string>; body?: string };
  }): Promise<ScenarioHttpResponse>;
}
