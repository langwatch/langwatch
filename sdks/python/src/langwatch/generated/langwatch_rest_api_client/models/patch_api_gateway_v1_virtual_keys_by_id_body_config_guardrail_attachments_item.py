from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_guardrail_attachments_item_direction import (
    PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItemDirection,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItem")


@_attrs_define
class PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItem:
    """
    Attributes:
        direction (PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItemDirection):
        guardrail_ids (list[str] | Unset):
    """

    direction: PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItemDirection
    guardrail_ids: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        direction = self.direction.value

        guardrail_ids: list[str] | Unset = UNSET
        if not isinstance(self.guardrail_ids, Unset):
            guardrail_ids = self.guardrail_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "direction": direction,
            }
        )
        if guardrail_ids is not UNSET:
            field_dict["guardrailIds"] = guardrail_ids

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        direction = PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItemDirection(d.pop("direction"))

        guardrail_ids = cast(list[str], d.pop("guardrailIds", UNSET))

        patch_api_gateway_v1_virtual_keys_by_id_body_config_guardrail_attachments_item = cls(
            direction=direction,
            guardrail_ids=guardrail_ids,
        )

        patch_api_gateway_v1_virtual_keys_by_id_body_config_guardrail_attachments_item.additional_properties = d
        return patch_api_gateway_v1_virtual_keys_by_id_body_config_guardrail_attachments_item

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
