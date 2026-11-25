from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiModelDefaultsResponse200EffectiveFASTType0")


@_attrs_define
class GetApiModelDefaultsResponse200EffectiveFASTType0:
    """
    Attributes:
        model (str):
        source (str):
        scope (None | str):
    """

    model: str
    source: str
    scope: None | str

    def to_dict(self) -> dict[str, Any]:
        model = self.model

        source = self.source

        scope: None | str
        scope = self.scope

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "model": model,
                "source": source,
                "scope": scope,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        model = d.pop("model")

        source = d.pop("source")

        def _parse_scope(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        scope = _parse_scope(d.pop("scope"))

        get_api_model_defaults_response_200_effective_fast_type_0 = cls(
            model=model,
            source=source,
            scope=scope,
        )

        return get_api_model_defaults_response_200_effective_fast_type_0
