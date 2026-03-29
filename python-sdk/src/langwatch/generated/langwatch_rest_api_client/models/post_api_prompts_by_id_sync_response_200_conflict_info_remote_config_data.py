from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_demonstrations import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataDemonstrations,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_inputs_item import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataInputsItem,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_messages_item import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItem,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_outputs_item import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItem,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_prompting_technique import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechnique,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_response_format import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormat,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData")


@_attrs_define
class PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData:
    """
    Attributes:
        prompt (str):
        messages (list['PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItem']):
        inputs (list['PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataInputsItem']):
        outputs (list['PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItem']):
        model (str):
        temperature (Union[Unset, float]):
        max_tokens (Union[Unset, float]):
        top_p (Union[Unset, float]):
        frequency_penalty (Union[Unset, float]):
        presence_penalty (Union[Unset, float]):
        seed (Union[Unset, float]):
        top_k (Union[Unset, float]):
        min_p (Union[Unset, float]):
        repetition_penalty (Union[Unset, float]):
        reasoning (Union[Unset, str]):
        reasoning_effort (Union[Unset, str]):
        thinking_level (Union[Unset, str]):
        effort (Union[Unset, str]):
        verbosity (Union[Unset, str]):
        demonstrations (Union[Unset, PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataDemonstrations]):
        prompting_technique (Union[Unset,
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechnique]):
        response_format (Union[Unset, PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormat]):
    """

    prompt: str
    messages: list["PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItem"]
    inputs: list["PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataInputsItem"]
    outputs: list["PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItem"]
    model: str
    temperature: Union[Unset, float] = UNSET
    max_tokens: Union[Unset, float] = UNSET
    top_p: Union[Unset, float] = UNSET
    frequency_penalty: Union[Unset, float] = UNSET
    presence_penalty: Union[Unset, float] = UNSET
    seed: Union[Unset, float] = UNSET
    top_k: Union[Unset, float] = UNSET
    min_p: Union[Unset, float] = UNSET
    repetition_penalty: Union[Unset, float] = UNSET
    reasoning: Union[Unset, str] = UNSET
    reasoning_effort: Union[Unset, str] = UNSET
    thinking_level: Union[Unset, str] = UNSET
    effort: Union[Unset, str] = UNSET
    verbosity: Union[Unset, str] = UNSET
    demonstrations: Union[Unset, "PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataDemonstrations"] = UNSET
    prompting_technique: Union[
        Unset, "PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechnique"
    ] = UNSET
    response_format: Union[Unset, "PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormat"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        prompt = self.prompt

        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        inputs = []
        for inputs_item_data in self.inputs:
            inputs_item = inputs_item_data.to_dict()
            inputs.append(inputs_item)

        outputs = []
        for outputs_item_data in self.outputs:
            outputs_item = outputs_item_data.to_dict()
            outputs.append(outputs_item)

        model = self.model

        temperature = self.temperature

        max_tokens = self.max_tokens

        top_p = self.top_p

        frequency_penalty = self.frequency_penalty

        presence_penalty = self.presence_penalty

        seed = self.seed

        top_k = self.top_k

        min_p = self.min_p

        repetition_penalty = self.repetition_penalty

        reasoning = self.reasoning

        reasoning_effort = self.reasoning_effort

        thinking_level = self.thinking_level

        effort = self.effort

        verbosity = self.verbosity

        demonstrations: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.demonstrations, Unset):
            demonstrations = self.demonstrations.to_dict()

        prompting_technique: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.prompting_technique, Unset):
            prompting_technique = self.prompting_technique.to_dict()

        response_format: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.response_format, Unset):
            response_format = self.response_format.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "prompt": prompt,
                "messages": messages,
                "inputs": inputs,
                "outputs": outputs,
                "model": model,
            }
        )
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if max_tokens is not UNSET:
            field_dict["max_tokens"] = max_tokens
        if top_p is not UNSET:
            field_dict["top_p"] = top_p
        if frequency_penalty is not UNSET:
            field_dict["frequency_penalty"] = frequency_penalty
        if presence_penalty is not UNSET:
            field_dict["presence_penalty"] = presence_penalty
        if seed is not UNSET:
            field_dict["seed"] = seed
        if top_k is not UNSET:
            field_dict["top_k"] = top_k
        if min_p is not UNSET:
            field_dict["min_p"] = min_p
        if repetition_penalty is not UNSET:
            field_dict["repetition_penalty"] = repetition_penalty
        if reasoning is not UNSET:
            field_dict["reasoning"] = reasoning
        if reasoning_effort is not UNSET:
            field_dict["reasoning_effort"] = reasoning_effort
        if thinking_level is not UNSET:
            field_dict["thinkingLevel"] = thinking_level
        if effort is not UNSET:
            field_dict["effort"] = effort
        if verbosity is not UNSET:
            field_dict["verbosity"] = verbosity
        if demonstrations is not UNSET:
            field_dict["demonstrations"] = demonstrations
        if prompting_technique is not UNSET:
            field_dict["prompting_technique"] = prompting_technique
        if response_format is not UNSET:
            field_dict["response_format"] = response_format

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_demonstrations import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataDemonstrations,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_inputs_item import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataInputsItem,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_messages_item import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItem,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_outputs_item import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItem,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_prompting_technique import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechnique,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_response_format import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormat,
        )

        d = dict(src_dict)
        prompt = d.pop("prompt")

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItem.from_dict(
                messages_item_data
            )

            messages.append(messages_item)

        inputs = []
        _inputs = d.pop("inputs")
        for inputs_item_data in _inputs:
            inputs_item = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataInputsItem.from_dict(
                inputs_item_data
            )

            inputs.append(inputs_item)

        outputs = []
        _outputs = d.pop("outputs")
        for outputs_item_data in _outputs:
            outputs_item = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItem.from_dict(
                outputs_item_data
            )

            outputs.append(outputs_item)

        model = d.pop("model")

        temperature = d.pop("temperature", UNSET)

        max_tokens = d.pop("max_tokens", UNSET)

        top_p = d.pop("top_p", UNSET)

        frequency_penalty = d.pop("frequency_penalty", UNSET)

        presence_penalty = d.pop("presence_penalty", UNSET)

        seed = d.pop("seed", UNSET)

        top_k = d.pop("top_k", UNSET)

        min_p = d.pop("min_p", UNSET)

        repetition_penalty = d.pop("repetition_penalty", UNSET)

        reasoning = d.pop("reasoning", UNSET)

        reasoning_effort = d.pop("reasoning_effort", UNSET)

        thinking_level = d.pop("thinkingLevel", UNSET)

        effort = d.pop("effort", UNSET)

        verbosity = d.pop("verbosity", UNSET)

        _demonstrations = d.pop("demonstrations", UNSET)
        demonstrations: Union[Unset, PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataDemonstrations]
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataDemonstrations.from_dict(
                _demonstrations
            )

        _prompting_technique = d.pop("prompting_technique", UNSET)
        prompting_technique: Union[
            Unset, PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechnique
        ]
        if isinstance(_prompting_technique, Unset):
            prompting_technique = UNSET
        else:
            prompting_technique = (
                PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechnique.from_dict(
                    _prompting_technique
                )
            )

        _response_format = d.pop("response_format", UNSET)
        response_format: Union[Unset, PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormat]
        if isinstance(_response_format, Unset):
            response_format = UNSET
        else:
            response_format = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormat.from_dict(
                _response_format
            )

        post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data = cls(
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
            seed=seed,
            top_k=top_k,
            min_p=min_p,
            repetition_penalty=repetition_penalty,
            reasoning=reasoning,
            reasoning_effort=reasoning_effort,
            thinking_level=thinking_level,
            effort=effort,
            verbosity=verbosity,
            demonstrations=demonstrations,
            prompting_technique=prompting_technique,
            response_format=response_format,
        )

        post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data.additional_properties = d
        return post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
