from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_evaluations_batch_log_results_body_targets_type_0_item_metadata_type_0 import (
        PostApiEvaluationsBatchLogResultsBodyTargetsType0ItemMetadataType0,
    )


T = TypeVar("T", bound="PostApiEvaluationsBatchLogResultsBodyTargetsType0Item")


@_attrs_define
class PostApiEvaluationsBatchLogResultsBodyTargetsType0Item:
    """
    Attributes:
        id (str):
        name (str):
        prompt_id (None | str | Unset):
        prompt_version (float | None | Unset):
        agent_id (None | str | Unset):
        evaluator_id (None | str | Unset):
        model (None | str | Unset):
        metadata (None | PostApiEvaluationsBatchLogResultsBodyTargetsType0ItemMetadataType0 | Unset):
        type_ (Literal['agent'] | Literal['custom'] | Literal['evaluator'] | Literal['prompt'] | Literal['workflow'] |
            Unset):
    """

    id: str
    name: str
    prompt_id: None | str | Unset = UNSET
    prompt_version: float | None | Unset = UNSET
    agent_id: None | str | Unset = UNSET
    evaluator_id: None | str | Unset = UNSET
    model: None | str | Unset = UNSET
    metadata: None | PostApiEvaluationsBatchLogResultsBodyTargetsType0ItemMetadataType0 | Unset = UNSET
    type_: (
        Literal["agent"] | Literal["custom"] | Literal["evaluator"] | Literal["prompt"] | Literal["workflow"] | Unset
    ) = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_evaluations_batch_log_results_body_targets_type_0_item_metadata_type_0 import (
            PostApiEvaluationsBatchLogResultsBodyTargetsType0ItemMetadataType0,
        )

        id = self.id

        name = self.name

        prompt_id: None | str | Unset
        if isinstance(self.prompt_id, Unset):
            prompt_id = UNSET
        else:
            prompt_id = self.prompt_id

        prompt_version: float | None | Unset
        if isinstance(self.prompt_version, Unset):
            prompt_version = UNSET
        else:
            prompt_version = self.prompt_version

        agent_id: None | str | Unset
        if isinstance(self.agent_id, Unset):
            agent_id = UNSET
        else:
            agent_id = self.agent_id

        evaluator_id: None | str | Unset
        if isinstance(self.evaluator_id, Unset):
            evaluator_id = UNSET
        else:
            evaluator_id = self.evaluator_id

        model: None | str | Unset
        if isinstance(self.model, Unset):
            model = UNSET
        else:
            model = self.model

        metadata: dict[str, Any] | None | Unset
        if isinstance(self.metadata, Unset):
            metadata = UNSET
        elif isinstance(self.metadata, PostApiEvaluationsBatchLogResultsBodyTargetsType0ItemMetadataType0):
            metadata = self.metadata.to_dict()
        else:
            metadata = self.metadata

        type_: (
            Literal["agent"]
            | Literal["custom"]
            | Literal["evaluator"]
            | Literal["prompt"]
            | Literal["workflow"]
            | Unset
        )
        if isinstance(self.type_, Unset):
            type_ = UNSET
        else:
            type_ = self.type_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
            }
        )
        if prompt_id is not UNSET:
            field_dict["prompt_id"] = prompt_id
        if prompt_version is not UNSET:
            field_dict["prompt_version"] = prompt_version
        if agent_id is not UNSET:
            field_dict["agent_id"] = agent_id
        if evaluator_id is not UNSET:
            field_dict["evaluator_id"] = evaluator_id
        if model is not UNSET:
            field_dict["model"] = model
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if type_ is not UNSET:
            field_dict["type"] = type_

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_evaluations_batch_log_results_body_targets_type_0_item_metadata_type_0 import (
            PostApiEvaluationsBatchLogResultsBodyTargetsType0ItemMetadataType0,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        def _parse_prompt_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        prompt_id = _parse_prompt_id(d.pop("prompt_id", UNSET))

        def _parse_prompt_version(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        prompt_version = _parse_prompt_version(d.pop("prompt_version", UNSET))

        def _parse_agent_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        agent_id = _parse_agent_id(d.pop("agent_id", UNSET))

        def _parse_evaluator_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        evaluator_id = _parse_evaluator_id(d.pop("evaluator_id", UNSET))

        def _parse_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model = _parse_model(d.pop("model", UNSET))

        def _parse_metadata(
            data: object,
        ) -> None | PostApiEvaluationsBatchLogResultsBodyTargetsType0ItemMetadataType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_type_0 = PostApiEvaluationsBatchLogResultsBodyTargetsType0ItemMetadataType0.from_dict(data)

                return metadata_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiEvaluationsBatchLogResultsBodyTargetsType0ItemMetadataType0 | Unset, data)

        metadata = _parse_metadata(d.pop("metadata", UNSET))

        def _parse_type_(
            data: object,
        ) -> (
            Literal["agent"]
            | Literal["custom"]
            | Literal["evaluator"]
            | Literal["prompt"]
            | Literal["workflow"]
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            type_type_0 = cast(Literal["prompt"], data)
            if type_type_0 != "prompt":
                raise ValueError(f"type_type_0 must match const 'prompt', got '{type_type_0}'")
            return type_type_0
            type_type_1 = cast(Literal["agent"], data)
            if type_type_1 != "agent":
                raise ValueError(f"type_type_1 must match const 'agent', got '{type_type_1}'")
            return type_type_1
            type_type_2 = cast(Literal["evaluator"], data)
            if type_type_2 != "evaluator":
                raise ValueError(f"type_type_2 must match const 'evaluator', got '{type_type_2}'")
            return type_type_2
            type_type_3 = cast(Literal["workflow"], data)
            if type_type_3 != "workflow":
                raise ValueError(f"type_type_3 must match const 'workflow', got '{type_type_3}'")
            return type_type_3
            type_type_4 = cast(Literal["custom"], data)
            if type_type_4 != "custom":
                raise ValueError(f"type_type_4 must match const 'custom', got '{type_type_4}'")
            return type_type_4

        type_ = _parse_type_(d.pop("type", UNSET))

        post_api_evaluations_batch_log_results_body_targets_type_0_item = cls(
            id=id,
            name=name,
            prompt_id=prompt_id,
            prompt_version=prompt_version,
            agent_id=agent_id,
            evaluator_id=evaluator_id,
            model=model,
            metadata=metadata,
            type_=type_,
        )

        post_api_evaluations_batch_log_results_body_targets_type_0_item.additional_properties = d
        return post_api_evaluations_batch_log_results_body_targets_type_0_item

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
