from enum import Enum


class PutApiModelProvidersByProviderBodyCustomEmbeddingsModelsType0ItemSupportedParametersItem(str, Enum):
    FREQUENCY_PENALTY = "frequency_penalty"
    MAX_TOKENS = "max_tokens"
    MIN_P = "min_p"
    PRESENCE_PENALTY = "presence_penalty"
    REASONING = "reasoning"
    REPETITION_PENALTY = "repetition_penalty"
    SEED = "seed"
    TEMPERATURE = "temperature"
    TOP_K = "top_k"
    TOP_P = "top_p"
    VERBOSITY = "verbosity"

    def __str__(self) -> str:
        return str(self.value)
