from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_model_defaults_response_200_effective_default_type_0 import (
        GetApiModelDefaultsResponse200EffectiveDEFAULTType0,
    )
    from ..models.get_api_model_defaults_response_200_effective_embeddings_type_0 import (
        GetApiModelDefaultsResponse200EffectiveEMBEDDINGSType0,
    )
    from ..models.get_api_model_defaults_response_200_effective_fast_type_0 import (
        GetApiModelDefaultsResponse200EffectiveFASTType0,
    )


T = TypeVar("T", bound="GetApiModelDefaultsResponse200Effective")


@_attrs_define
class GetApiModelDefaultsResponse200Effective:
    """
    Attributes:
        default (GetApiModelDefaultsResponse200EffectiveDEFAULTType0 | None):
        fast (GetApiModelDefaultsResponse200EffectiveFASTType0 | None):
        embeddings (GetApiModelDefaultsResponse200EffectiveEMBEDDINGSType0 | None):
    """

    default: GetApiModelDefaultsResponse200EffectiveDEFAULTType0 | None
    fast: GetApiModelDefaultsResponse200EffectiveFASTType0 | None
    embeddings: GetApiModelDefaultsResponse200EffectiveEMBEDDINGSType0 | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_model_defaults_response_200_effective_default_type_0 import (
            GetApiModelDefaultsResponse200EffectiveDEFAULTType0,
        )
        from ..models.get_api_model_defaults_response_200_effective_embeddings_type_0 import (
            GetApiModelDefaultsResponse200EffectiveEMBEDDINGSType0,
        )
        from ..models.get_api_model_defaults_response_200_effective_fast_type_0 import (
            GetApiModelDefaultsResponse200EffectiveFASTType0,
        )

        default: dict[str, Any] | None
        if isinstance(self.default, GetApiModelDefaultsResponse200EffectiveDEFAULTType0):
            default = self.default.to_dict()
        else:
            default = self.default

        fast: dict[str, Any] | None
        if isinstance(self.fast, GetApiModelDefaultsResponse200EffectiveFASTType0):
            fast = self.fast.to_dict()
        else:
            fast = self.fast

        embeddings: dict[str, Any] | None
        if isinstance(self.embeddings, GetApiModelDefaultsResponse200EffectiveEMBEDDINGSType0):
            embeddings = self.embeddings.to_dict()
        else:
            embeddings = self.embeddings

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "DEFAULT": default,
                "FAST": fast,
                "EMBEDDINGS": embeddings,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_model_defaults_response_200_effective_default_type_0 import (
            GetApiModelDefaultsResponse200EffectiveDEFAULTType0,
        )
        from ..models.get_api_model_defaults_response_200_effective_embeddings_type_0 import (
            GetApiModelDefaultsResponse200EffectiveEMBEDDINGSType0,
        )
        from ..models.get_api_model_defaults_response_200_effective_fast_type_0 import (
            GetApiModelDefaultsResponse200EffectiveFASTType0,
        )

        d = dict(src_dict)

        def _parse_default(data: object) -> GetApiModelDefaultsResponse200EffectiveDEFAULTType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                default_type_0 = GetApiModelDefaultsResponse200EffectiveDEFAULTType0.from_dict(data)

                return default_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiModelDefaultsResponse200EffectiveDEFAULTType0 | None, data)

        default = _parse_default(d.pop("DEFAULT"))

        def _parse_fast(data: object) -> GetApiModelDefaultsResponse200EffectiveFASTType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                fast_type_0 = GetApiModelDefaultsResponse200EffectiveFASTType0.from_dict(data)

                return fast_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiModelDefaultsResponse200EffectiveFASTType0 | None, data)

        fast = _parse_fast(d.pop("FAST"))

        def _parse_embeddings(data: object) -> GetApiModelDefaultsResponse200EffectiveEMBEDDINGSType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                embeddings_type_0 = GetApiModelDefaultsResponse200EffectiveEMBEDDINGSType0.from_dict(data)

                return embeddings_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiModelDefaultsResponse200EffectiveEMBEDDINGSType0 | None, data)

        embeddings = _parse_embeddings(d.pop("EMBEDDINGS"))

        get_api_model_defaults_response_200_effective = cls(
            default=default,
            fast=fast,
            embeddings=embeddings,
        )

        get_api_model_defaults_response_200_effective.additional_properties = d
        return get_api_model_defaults_response_200_effective

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
