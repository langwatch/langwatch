from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_targets_type_0_item_metadata_type_0 import (
        GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0ItemMetadataType0,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0Item")


@_attrs_define
class GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0Item:
    """
    Attributes:
        id (str):
        name (str):
        type_ (str):
        prompt_id (None | str | Unset):
        prompt_version (float | None | Unset):
        agent_id (None | str | Unset):
        agent_label (None | str | Unset): The deploy label an agent target ran at, such as production
        agent_version (int | None | Unset): The agent version the label pointed at when the run started
        evaluator_id (None | str | Unset):
        model (None | str | Unset):
        metadata (GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0ItemMetadataType0 | None | Unset):
    """

    id: str
    name: str
    type_: str
    prompt_id: None | str | Unset = UNSET
    prompt_version: float | None | Unset = UNSET
    agent_id: None | str | Unset = UNSET
    agent_label: None | str | Unset = UNSET
    agent_version: int | None | Unset = UNSET
    evaluator_id: None | str | Unset = UNSET
    model: None | str | Unset = UNSET
    metadata: GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0ItemMetadataType0 | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_targets_type_0_item_metadata_type_0 import (
            GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0ItemMetadataType0,
        )

        id = self.id

        name = self.name

        type_ = self.type_

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

        agent_label: None | str | Unset
        if isinstance(self.agent_label, Unset):
            agent_label = UNSET
        else:
            agent_label = self.agent_label

        agent_version: int | None | Unset
        if isinstance(self.agent_version, Unset):
            agent_version = UNSET
        else:
            agent_version = self.agent_version

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
        elif isinstance(self.metadata, GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0ItemMetadataType0):
            metadata = self.metadata.to_dict()
        else:
            metadata = self.metadata

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "type": type_,
            }
        )
        if prompt_id is not UNSET:
            field_dict["promptId"] = prompt_id
        if prompt_version is not UNSET:
            field_dict["promptVersion"] = prompt_version
        if agent_id is not UNSET:
            field_dict["agentId"] = agent_id
        if agent_label is not UNSET:
            field_dict["agentLabel"] = agent_label
        if agent_version is not UNSET:
            field_dict["agentVersion"] = agent_version
        if evaluator_id is not UNSET:
            field_dict["evaluatorId"] = evaluator_id
        if model is not UNSET:
            field_dict["model"] = model
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_targets_type_0_item_metadata_type_0 import (
            GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0ItemMetadataType0,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        type_ = d.pop("type")

        def _parse_prompt_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        prompt_id = _parse_prompt_id(d.pop("promptId", UNSET))

        def _parse_prompt_version(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        prompt_version = _parse_prompt_version(d.pop("promptVersion", UNSET))

        def _parse_agent_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        agent_id = _parse_agent_id(d.pop("agentId", UNSET))

        def _parse_agent_label(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        agent_label = _parse_agent_label(d.pop("agentLabel", UNSET))

        def _parse_agent_version(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        agent_version = _parse_agent_version(d.pop("agentVersion", UNSET))

        def _parse_evaluator_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        evaluator_id = _parse_evaluator_id(d.pop("evaluatorId", UNSET))

        def _parse_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model = _parse_model(d.pop("model", UNSET))

        def _parse_metadata(
            data: object,
        ) -> GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0ItemMetadataType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_type_0 = GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0ItemMetadataType0.from_dict(
                    data
                )

                return metadata_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0ItemMetadataType0 | None | Unset, data
            )

        metadata = _parse_metadata(d.pop("metadata", UNSET))

        get_api_experiments_runs_by_run_id_results_response_200_targets_type_0_item = cls(
            id=id,
            name=name,
            type_=type_,
            prompt_id=prompt_id,
            prompt_version=prompt_version,
            agent_id=agent_id,
            agent_label=agent_label,
            agent_version=agent_version,
            evaluator_id=evaluator_id,
            model=model,
            metadata=metadata,
        )

        return get_api_experiments_runs_by_run_id_results_response_200_targets_type_0_item
