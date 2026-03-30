from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_prompts_by_id_sync_response_200_prompt_scope import PostApiPromptsByIdSyncResponse200PromptScope
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_demonstrations import (
        PostApiPromptsByIdSyncResponse200PromptDemonstrations,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_inputs_item import (
        PostApiPromptsByIdSyncResponse200PromptInputsItem,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_messages_item import (
        PostApiPromptsByIdSyncResponse200PromptMessagesItem,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_outputs_item import (
        PostApiPromptsByIdSyncResponse200PromptOutputsItem,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_prompting_technique import (
        PostApiPromptsByIdSyncResponse200PromptPromptingTechnique,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_response_format import (
        PostApiPromptsByIdSyncResponse200PromptResponseFormat,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200Prompt")


@_attrs_define
class PostApiPromptsByIdSyncResponse200Prompt:
    """
    Attributes:
        id (str):
        handle (Union[None, str]):
        scope (PostApiPromptsByIdSyncResponse200PromptScope):
        name (str):
        updated_at (str):
        project_id (str):
        organization_id (str):
        version_id (str):
        version (float):
        created_at (str):
        prompt (str):
        messages (list['PostApiPromptsByIdSyncResponse200PromptMessagesItem']):
        inputs (list['PostApiPromptsByIdSyncResponse200PromptInputsItem']):
        outputs (list['PostApiPromptsByIdSyncResponse200PromptOutputsItem']):
        model (str):
        author_id (Union[None, Unset, str]):
        commit_message (Union[None, Unset, str]):
        temperature (Union[Unset, float]):
        max_tokens (Union[Unset, float]):
        demonstrations (Union[Unset, PostApiPromptsByIdSyncResponse200PromptDemonstrations]):
        prompting_technique (Union[Unset, PostApiPromptsByIdSyncResponse200PromptPromptingTechnique]):
        response_format (Union[Unset, PostApiPromptsByIdSyncResponse200PromptResponseFormat]):
    """

    id: str
    handle: Union[None, str]
    scope: PostApiPromptsByIdSyncResponse200PromptScope
    name: str
    updated_at: str
    project_id: str
    organization_id: str
    version_id: str
    version: float
    created_at: str
    prompt: str
    messages: list["PostApiPromptsByIdSyncResponse200PromptMessagesItem"]
    inputs: list["PostApiPromptsByIdSyncResponse200PromptInputsItem"]
    outputs: list["PostApiPromptsByIdSyncResponse200PromptOutputsItem"]
    model: str
    author_id: Union[None, Unset, str] = UNSET
    commit_message: Union[None, Unset, str] = UNSET
    temperature: Union[Unset, float] = UNSET
    max_tokens: Union[Unset, float] = UNSET
    demonstrations: Union[Unset, "PostApiPromptsByIdSyncResponse200PromptDemonstrations"] = UNSET
    prompting_technique: Union[Unset, "PostApiPromptsByIdSyncResponse200PromptPromptingTechnique"] = UNSET
    response_format: Union[Unset, "PostApiPromptsByIdSyncResponse200PromptResponseFormat"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        handle: Union[None, str]
        handle = self.handle

        scope = self.scope.value

        name = self.name

        updated_at = self.updated_at

        project_id = self.project_id

        organization_id = self.organization_id

        version_id = self.version_id

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

        author_id: Union[None, Unset, str]
        if isinstance(self.author_id, Unset):
            author_id = UNSET
        else:
            author_id = self.author_id

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
                "id": id,
                "handle": handle,
                "scope": scope,
                "name": name,
                "updatedAt": updated_at,
                "projectId": project_id,
                "organizationId": organization_id,
                "versionId": version_id,
                "version": version,
                "createdAt": created_at,
                "prompt": prompt,
                "messages": messages,
                "inputs": inputs,
                "outputs": outputs,
                "model": model,
            }
        )
        if author_id is not UNSET:
            field_dict["authorId"] = author_id
        if commit_message is not UNSET:
            field_dict["commitMessage"] = commit_message
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if max_tokens is not UNSET:
            field_dict["maxTokens"] = max_tokens
        if demonstrations is not UNSET:
            field_dict["demonstrations"] = demonstrations
        if prompting_technique is not UNSET:
            field_dict["promptingTechnique"] = prompting_technique
        if response_format is not UNSET:
            field_dict["responseFormat"] = response_format

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_demonstrations import (
            PostApiPromptsByIdSyncResponse200PromptDemonstrations,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_inputs_item import (
            PostApiPromptsByIdSyncResponse200PromptInputsItem,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_messages_item import (
            PostApiPromptsByIdSyncResponse200PromptMessagesItem,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_outputs_item import (
            PostApiPromptsByIdSyncResponse200PromptOutputsItem,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_prompting_technique import (
            PostApiPromptsByIdSyncResponse200PromptPromptingTechnique,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_response_format import (
            PostApiPromptsByIdSyncResponse200PromptResponseFormat,
        )

        d = dict(src_dict)
        id = d.pop("id")

        def _parse_handle(data: object) -> Union[None, str]:
            if data is None:
                return data
            return cast(Union[None, str], data)

        handle = _parse_handle(d.pop("handle"))

        scope = PostApiPromptsByIdSyncResponse200PromptScope(d.pop("scope"))

        name = d.pop("name")

        updated_at = d.pop("updatedAt")

        project_id = d.pop("projectId")

        organization_id = d.pop("organizationId")

        version_id = d.pop("versionId")

        version = d.pop("version")

        created_at = d.pop("createdAt")

        prompt = d.pop("prompt")

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = PostApiPromptsByIdSyncResponse200PromptMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        inputs = []
        _inputs = d.pop("inputs")
        for inputs_item_data in _inputs:
            inputs_item = PostApiPromptsByIdSyncResponse200PromptInputsItem.from_dict(inputs_item_data)

            inputs.append(inputs_item)

        outputs = []
        _outputs = d.pop("outputs")
        for outputs_item_data in _outputs:
            outputs_item = PostApiPromptsByIdSyncResponse200PromptOutputsItem.from_dict(outputs_item_data)

            outputs.append(outputs_item)

        model = d.pop("model")

        def _parse_author_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        author_id = _parse_author_id(d.pop("authorId", UNSET))

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
        demonstrations: Union[Unset, PostApiPromptsByIdSyncResponse200PromptDemonstrations]
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = PostApiPromptsByIdSyncResponse200PromptDemonstrations.from_dict(_demonstrations)

        _prompting_technique = d.pop("promptingTechnique", UNSET)
        prompting_technique: Union[Unset, PostApiPromptsByIdSyncResponse200PromptPromptingTechnique]
        if isinstance(_prompting_technique, Unset):
            prompting_technique = UNSET
        else:
            prompting_technique = PostApiPromptsByIdSyncResponse200PromptPromptingTechnique.from_dict(
                _prompting_technique
            )

        _response_format = d.pop("responseFormat", UNSET)
        response_format: Union[Unset, PostApiPromptsByIdSyncResponse200PromptResponseFormat]
        if isinstance(_response_format, Unset):
            response_format = UNSET
        else:
            response_format = PostApiPromptsByIdSyncResponse200PromptResponseFormat.from_dict(_response_format)

        post_api_prompts_by_id_sync_response_200_prompt = cls(
            id=id,
            handle=handle,
            scope=scope,
            name=name,
            updated_at=updated_at,
            project_id=project_id,
            organization_id=organization_id,
            version_id=version_id,
            version=version,
            created_at=created_at,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
            model=model,
            author_id=author_id,
            commit_message=commit_message,
            temperature=temperature,
            max_tokens=max_tokens,
            demonstrations=demonstrations,
            prompting_technique=prompting_technique,
            response_format=response_format,
        )

        post_api_prompts_by_id_sync_response_200_prompt.additional_properties = d
        return post_api_prompts_by_id_sync_response_200_prompt

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
