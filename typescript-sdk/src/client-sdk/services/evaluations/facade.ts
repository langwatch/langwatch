import { trace, Tracer } from "@opentelemetry/api";
import { type InternalConfig } from "../../types";

export class EvaluationsFacade {
  readonly #tracer: Tracer = trace.getTracer("langwatch.evaluations");
  readonly #config: InternalConfig;

  constructor(config: InternalConfig) {
    this.#config = config;
  }

  static defaultOptions: InternalConfig["evaluations"] = {};
}
