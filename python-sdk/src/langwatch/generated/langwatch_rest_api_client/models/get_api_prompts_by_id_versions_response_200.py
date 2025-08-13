from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_prompts_by_id_versions_response_200_demonstrations import (
        GetApiPromptsByIdVersionsResponse200Demonstrations,
    )
    from ..models.get_api_prompts_by_id_versions_response_200_inputs_item import (
        GetApiPromptsByIdVersionsResponse200InputsItem,
    )
    from ..models.get_api_prompts_by_id_versions_response_200_messages_item import (
        GetApiPromptsByIdVersionsResponse200MessagesItem,
    )
    from ..models.get_api_prompts_by_id_versions_response_200_outputs_item import (
        GetApiPromptsByIdVersionsResponse200OutputsItem,
    )
    from ..models.get_api_prompts_by_id_versions_response_200_prampting_technique import (
        GetApiPromptsByIdVersionsResponse200PramptingTechnique,
    )
    from ..models.get_api_prompts_by_id_versions_response_200_response_format import (
        GetApiPromptsByIdVersionsResponse200ResponseFormat,
    )


T = TypeVar("T", bound="GetApiPromptsByIdVersionsResponse200")


@_attrs_define
class GetApiPromptsByIdVersionsResponse200:
    """
    Attributes:
        config_id (str):
        project_id (str):
        version_id (str):
        author_id (Union[None, str]):
        version (float):
        created_at (str):
        prompt (str):
        messages (list['GetApiPromptsByIdVersionsResponse200MessagesItem']):
        inputs (list['GetApiPromptsByIdVersionsResponse200InputsItem']):
        outputs (list['GetApiPromptsByIdVersionsResponse200OutputsItem']):
        model (str):
        commit_message (Union[None, Unset, str]):
        temperature (Union[Unset, float]):
        max_tokens (Union[Unset, float]):
        demonstrations (Union[Unset, GetApiPromptsByIdVersionsResponse200Demonstrations]):
        prampting_technique (Union[Unset, GetApiPromptsByIdVersionsResponse200PramptingTechnique]):
        response_format (Union[Unset, GetApiPromptsByIdVersionsResponse200ResponseFormat]):
    """

    config_id: str
    project_id: str
    version_id: str
    author_id: Union[None, str]
    version: float
    created_at: str
    prompt: str
    messages: list["GetApiPromptsByIdVersionsResponse200MessagesItem"]
    inputs: list["GetApiPromptsByIdVersionsResponse200InputsItem"]
    outputs: list["GetApiPromptsByIdVersionsResponse200OutputsItem"]
    model: str
    commit_message: Union[None, Unset, str] = UNSET
    temperature: Union[Unset, float] = UNSET
    max_tokens: Union[Unset, float] = UNSET
    demonstrations: Union[
        Unset, "GetApiPromptsByIdVersionsResponse200Demonstrations"
    ] = UNSET
    prampting_technique: Union[
        Unset, "GetApiPromptsByIdVersionsResponse200PramptingTechnique"
    ] = UNSET
    response_format: Union[
        Unset, "GetApiPromptsByIdVersionsResponse200ResponseFormat"
    ] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        config_id = self.config_id

        project_id = self.project_id

        version_id = self.version_id

        author_id: Union[None, str]
        author_id = self.author_id

        version = self.version

        created_at = self.created_at

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

        commit_message: Union[None, Unset, str]
        if isinstance(self.commit_message, Unset):
            commit_message = UNSET
        else:
            commit_message = self.commit_message

        temperature = self.temperature

        max_tokens = self.max_tokens

        demonstrations: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.demonstrations, Unset):
            demonstrations = self.demonstrations.to_dict()

        prampting_technique: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.prampting_technique, Unset):
            prampting_technique = self.prampting_technique.to_dict()

        response_format: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.response_format, Unset):
            response_format = self.response_format.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "configId": config_id,
                "projectId": project_id,
                "versionId": version_id,
                "authorId": author_id,
                "version": version,
                "createdAt": created_at,
                "prompt": prompt,
                "messages": messages,
                "inputs": inputs,
                "outputs": outputs,
                "model": model,
            }
        )
        if commit_message is not UNSET:
            field_dict["commitMessage"] = commit_message
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if max_tokens is not UNSET:
            field_dict["maxTokens"] = max_tokens
        if demonstrations is not UNSET:
            field_dict["demonstrations"] = demonstrations
        if prampting_technique is not UNSET:
            field_dict["promptingTechnique"] = prampting_technique
        if response_format is not UNSET:
            field_dict["responseFormat"] = response_format

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_prompts_by_id_versions_response_200_demonstrations import (
            GetApiPromptsByIdVersionsResponse200Demonstrations,
        )
        from ..models.get_api_prompts_by_id_versions_response_200_inputs_item import (
            GetApiPromptsByIdVersionsResponse200InputsItem,
        )
        from ..models.get_api_prompts_by_id_versions_response_200_messages_item import (
            GetApiPromptsByIdVersionsResponse200MessagesItem,
        )
        from ..models.get_api_prompts_by_id_versions_response_200_outputs_item import (
            GetApiPromptsByIdVersionsResponse200OutputsItem,
        )
        from ..models.get_api_prompts_by_id_versions_response_200_prampting_technique import (
            GetApiPromptsByIdVersionsResponse200PramptingTechnique,
        )
        from ..models.get_api_prompts_by_id_versions_response_200_response_format import (
            GetApiPromptsByIdVersionsResponse200ResponseFormat,
        )

        d = dict(src_dict)
        config_id = d.pop("configId")

        project_id = d.pop("projectId")

        version_id = d.pop("versionId")

        def _parse_author_id(data: object) -> Union[None, str]:
            if data is None:
                return data
            return cast(Union[None, str], data)

        author_id = _parse_author_id(d.pop("authorId"))

        version = d.pop("version")

        created_at = d.pop("createdAt")

        prompt = d.pop("prompt")

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = GetApiPromptsByIdVersionsResponse200MessagesItem.from_dict(
                messages_item_data
            )

            messages.append(messages_item)

        inputs = []
        _inputs = d.pop("inputs")
        for inputs_item_data in _inputs:
            inputs_item = GetApiPromptsByIdVersionsResponse200InputsItem.from_dict(
                inputs_item_data
            )

            inputs.append(inputs_item)

        outputs = []
        _outputs = d.pop("outputs")
        for outputs_item_data in _outputs:
            outputs_item = GetApiPromptsByIdVersionsResponse200OutputsItem.from_dict(
                outputs_item_data
            )

            outputs.append(outputs_item)

        model = d.pop("model")

        def _parse_commit_message(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        commit_message = _parse_commit_message(d.pop("commitMessage", UNSET))

        temperature = d.pop("temperature", UNSET)

        max_tokens = d.pop("maxTokens", UNSET)

        _demonstrations = d.pop("demonstrations", UNSET)
        demonstrations: Union[Unset, GetApiPromptsByIdVersionsResponse200Demonstrations]
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = (
                GetApiPromptsByIdVersionsResponse200Demonstrations.from_dict(
                    _demonstrations
                )
            )

        _prampting_technique = d.pop("promptingTechnique", UNSET)
        prampting_technique: Union[
            Unset, GetApiPromptsByIdVersionsResponse200PramptingTechnique
        ]
        if isinstance(_prampting_technique, Unset):
            prampting_technique = UNSET
        else:
            prampting_technique = (
                GetApiPromptsByIdVersionsResponse200PramptingTechnique.from_dict(
                    _prampting_technique
                )
            )

        _response_format = d.pop("responseFormat", UNSET)
        response_format: Union[
            Unset, GetApiPromptsByIdVersionsResponse200ResponseFormat
        ]
        if isinstance(_response_format, Unset):
            response_format = UNSET
        else:
            response_format = (
                GetApiPromptsByIdVersionsResponse200ResponseFormat.from_dict(
                    _response_format
                )
            )

        get_api_prompts_by_id_versions_response_200 = cls(
            config_id=config_id,
            project_id=project_id,
            version_id=version_id,
            author_id=author_id,
            version=version,
            created_at=created_at,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
            model=model,
            commit_message=commit_message,
            temperature=temperature,
            max_tokens=max_tokens,
            demonstrations=demonstrations,
            prampting_technique=prampting_technique,
            response_format=response_format,
        )

        get_api_prompts_by_id_versions_response_200.additional_properties = d
        return get_api_prompts_by_id_versions_response_200

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
