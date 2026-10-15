from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_4_config import CreateAgentBodyType4Config


T = TypeVar("T", bound="CreateAgentBodyType4")


@_attrs_define
class CreateAgentBodyType4:
    """
    Attributes:
        name (str):
        type_ (Literal['connected']):
        config (CreateAgentBodyType4Config):
        workflow_id (str | Unset):
        copied_from_agent_id (str | Unset):
    """

    name: str
    type_: Literal["connected"]
    config: CreateAgentBodyType4Config
    workflow_id: str | Unset = UNSET
    copied_from_agent_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        config = self.config.to_dict()

        workflow_id = self.workflow_id

        copied_from_agent_id = self.copied_from_agent_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "type": type_,
                "config": config,
            }
        )
        if workflow_id is not UNSET:
            field_dict["workflowId"] = workflow_id
        if copied_from_agent_id is not UNSET:
            field_dict["copiedFromAgentId"] = copied_from_agent_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_4_config import CreateAgentBodyType4Config

        d = dict(src_dict)
        name = d.pop("name")

        type_ = cast(Literal["connected"], d.pop("type"))
        if type_ != "connected":
            raise ValueError(f"type must match const 'connected', got '{type_}'")

        config = CreateAgentBodyType4Config.from_dict(d.pop("config"))

        workflow_id = d.pop("workflowId", UNSET)

        copied_from_agent_id = d.pop("copiedFromAgentId", UNSET)

        create_agent_body_type_4 = cls(
            name=name,
            type_=type_,
            config=config,
            workflow_id=workflow_id,
            copied_from_agent_id=copied_from_agent_id,
        )

        create_agent_body_type_4.additional_properties = d
        return create_agent_body_type_4

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
