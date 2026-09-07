from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiGatewayV1VirtualKeysByIdBodyConfigRateLimits")


@_attrs_define
class PatchApiGatewayV1VirtualKeysByIdBodyConfigRateLimits:
    """
    Attributes:
        rpm (int | None | Unset):
        tpm (int | None | Unset):
        rpd (int | None | Unset):
    """

    rpm: int | None | Unset = UNSET
    tpm: int | None | Unset = UNSET
    rpd: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        rpm: int | None | Unset
        if isinstance(self.rpm, Unset):
            rpm = UNSET
        else:
            rpm = self.rpm

        tpm: int | None | Unset
        if isinstance(self.tpm, Unset):
            tpm = UNSET
        else:
            tpm = self.tpm

        rpd: int | None | Unset
        if isinstance(self.rpd, Unset):
            rpd = UNSET
        else:
            rpd = self.rpd

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if rpm is not UNSET:
            field_dict["rpm"] = rpm
        if tpm is not UNSET:
            field_dict["tpm"] = tpm
        if rpd is not UNSET:
            field_dict["rpd"] = rpd

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_rpm(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        rpm = _parse_rpm(d.pop("rpm", UNSET))

        def _parse_tpm(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        tpm = _parse_tpm(d.pop("tpm", UNSET))

        def _parse_rpd(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        rpd = _parse_rpd(d.pop("rpd", UNSET))

        patch_api_gateway_v1_virtual_keys_by_id_body_config_rate_limits = cls(
            rpm=rpm,
            tpm=tpm,
            rpd=rpd,
        )

        patch_api_gateway_v1_virtual_keys_by_id_body_config_rate_limits.additional_properties = d
        return patch_api_gateway_v1_virtual_keys_by_id_body_config_rate_limits

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
