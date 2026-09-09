import type { LanguageModel } from "ai";

/**
 * The one question the title generator asks of the deployment's model gateway.
 *
 * A port rather than the gateway itself, because WHICH model a project's title
 * call runs on is the deployment's cascade — the project's execution providers,
 * the feature key's resolution, the alternate when the resolved provider is
 * disabled and the execution parameters the proxy is handed. Langy owns the
 * prompt and the shape of a title; it owns none of that.
 *
 * The two-step resolution is the ADAPTER's, not this package's. A process
 * resolves the feature key first, and falls back to the named model only when
 * the cascade says nothing is configured for that key — and "nothing is
 * configured" is a typed refusal from the model-provider contract, which a
 * feature package that never depends on it cannot distinguish from a real
 * failure. Handing the fallback down as an argument is what keeps the
 * distinction where the type lives.
 */
export abstract class LangyTitleModelPort {
  /**
   * The handle a title call runs on.
   *
   * Rejects rather than answering `null`: the generator turns any failure into
   * "the conversation keeps the title it has", and a resolver that answered
   * `null` would make an unconfigured deployment and a broken one look the
   * same in the one log line that reports it.
   */
  abstract resolveTitleModel(input: {
    projectId: string;
    /** The cascade key a project may have pointed somewhere specific. */
    featureKey: string;
    /** The model to use where the key resolves to nothing at any scope. */
    fallbackModel: string;
  }): Promise<LanguageModel>;
}
