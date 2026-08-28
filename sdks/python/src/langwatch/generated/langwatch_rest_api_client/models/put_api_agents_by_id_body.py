from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.put_api_agents_by_id_body_type import PutApiAgentsByIdBodyType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_agents_by_id_body_config import PutApiAgentsByIdBodyConfig


T = TypeVar("T", bound="PutApiAgentsByIdBody")


@_attrs_define
class PutApiAgentsByIdBody:
    """
    Attributes:
        name (str | Unset):
        type_ (PutApiAgentsByIdBodyType | Unset):
        config (PutApiAgentsByIdBodyConfig | Unset):
        workflow_id (None | str | Unset):
    """

    name: str | Unset = UNSET
    type_: PutApiAgentsByIdBodyType | Unset = UNSET
    config: PutApiAgentsByIdBodyConfig | Unset = UNSET
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
        from ..models.put_api_agents_by_id_body_config import PutApiAgentsByIdBodyConfig

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _type_ = d.pop("type", UNSET)
        type_: PutApiAgentsByIdBodyType | Unset
        if isinstance(_type_, Unset):
            type_ = UNSET
        else:
            type_ = PutApiAgentsByIdBodyType(_type_)

        _config = d.pop("config", UNSET)
        config: PutApiAgentsByIdBodyConfig | Unset
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = PutApiAgentsByIdBodyConfig.from_dict(_config)

        def _parse_workflow_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        workflow_id = _parse_workflow_id(d.pop("workflowId", UNSET))

        put_api_agents_by_id_body = cls(
            name=name,
            type_=type_,
            config=config,
            workflow_id=workflow_id,
        )

        put_api_agents_by_id_body.additional_properties = d
        return put_api_agents_by_id_body

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
