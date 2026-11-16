from enum import Enum


class PostApiPromptsResponse200PromptingTechniqueType(str, Enum):
    CHAIN_OF_THOUGHT = "chain_of_thought"
    FEW_SHOT = "few_shot"
    IN_CONTEXT = "in_context"

    def __str__(self) -> str:
        return str(self.value)
