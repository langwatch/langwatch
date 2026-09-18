from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_agents_by_id_body_type import PatchApiAgentsByIdBodyType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_agents_by_id_body_config import PatchApiAgentsByIdBodyConfig


T = TypeVar("T", bound="PatchApiAgentsByIdBody")


@_attrs_define
class PatchApiAgentsByIdBody:
    """
    Attributes:
        name (str | Unset):
        type_ (PatchApiAgentsByIdBodyType | Unset):
        config (PatchApiAgentsByIdBodyConfig | Unset):
        workflow_id (None | str | Unset):
    """

    name: str | Unset = UNSET
    type_: PatchApiAgentsByIdBodyType | Unset = UNSET
    config: PatchApiAgentsByIdBodyConfig | Unset = UNSET
    workflow_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value

        config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.config, Unset):
            config = self.config.to_dict()

        workflow_id: None | str | Unset
        if isinstance(self.workflow_id, Unset):
            workflow_id = UNSET
        else:
            workflow_id = self.workflow_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if type_ is not UNSET:
            field_dict["type"] = type_
        if config is not UNSET:
            field_dict["config"] = config
        if workflow_id is not UNSET:
            field_dict["workflowId"] = workflow_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_agents_by_id_body_config import PatchApiAgentsByIdBodyConfig

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _type_ = d.pop("type", UNSET)
        type_: PatchApiAgentsByIdBodyType | Unset
        if isinstance(_type_, Unset):
            type_ = UNSET
        else:
            type_ = PatchApiAgentsByIdBodyType(_type_)

        _config = d.pop("config", UNSET)
        config: PatchApiAgentsByIdBodyConfig | Unset
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = PatchApiAgentsByIdBodyConfig.from_dict(_config)

        def _parse_workflow_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        workflow_id = _parse_workflow_id(d.pop("workflowId", UNSET))

        patch_api_agents_by_id_body = cls(
            name=name,
            type_=type_,
            config=config,
            workflow_id=workflow_id,
        )

        patch_api_agents_by_id_body.additional_properties = d
        return patch_api_agents_by_id_body

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
