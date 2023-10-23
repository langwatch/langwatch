import { Tiktoken } from "tiktoken/lite";
import { load } from "tiktoken/load";
import registry from "tiktoken/registry.json";
import models from "tiktoken/model_to_encoding.json";
import { getDebugger } from "../../utils/logger";

const debug = getDebugger("langwatch:tokenCount");

let model:
  | {
      explicit_n_vocab: number | undefined;
      pat_str: string;
      special_tokens: Record<string, number>;
      bpe_ranks: string;
    }
  | undefined;
let encoder: Tiktoken | undefined;

const initTikToken = async () => {
  if (!model) {
    debug("Initializing gpt-3.5-turbo token count");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    model = await load((registry as any)[models["gpt-3.5-turbo"]]);
  }
  if (!encoder) {
    encoder = new Tiktoken(
      model.bpe_ranks,
      model.special_tokens,
      model.pat_str
    );
  }

  return { model, encoder };
};

// TODO: test
export const countTokens = async (text: string) => {
  if (!text) return 0;

  const { encoder } = await initTikToken();

  return encoder.encode(text).length;
};
