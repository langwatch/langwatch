from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_1_config import CreateAgentBodyType1Config


T = TypeVar("T", bound="CreateAgentBodyType1")


@_attrs_define
class CreateAgentBodyType1:
    """
    Attributes:
        name (str):
        type_ (Literal['code']):
        config (CreateAgentBodyType1Config):
        workflow_id (str | Unset):
        copied_from_agent_id (str | Unset):
    """

    name: str
    type_: Literal["code"]
    config: CreateAgentBodyType1Config
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
        from ..models.create_agent_body_type_1_config import CreateAgentBodyType1Config

        d = dict(src_dict)
        name = d.pop("name")

        type_ = cast(Literal["code"], d.pop("type"))
        if type_ != "code":
            raise ValueError(f"type must match const 'code', got '{type_}'")

        config = CreateAgentBodyType1Config.from_dict(d.pop("config"))

        workflow_id = d.pop("workflowId", UNSET)

        copied_from_agent_id = d.pop("copiedFromAgentId", UNSET)

        create_agent_body_type_1 = cls(
            name=name,
            type_=type_,
            config=config,
            workflow_id=workflow_id,
            copied_from_agent_id=copied_from_agent_id,
        )

        create_agent_body_type_1.additional_properties = d
        return create_agent_body_type_1

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
