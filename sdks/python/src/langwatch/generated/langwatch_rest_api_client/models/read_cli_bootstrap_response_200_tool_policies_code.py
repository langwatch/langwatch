from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliBootstrapResponse200ToolPoliciesCode")


@_attrs_define
class ReadCliBootstrapResponse200ToolPoliciesCode:
    """
    Attributes:
        allow_vk (bool):
        allow_otel_direct (bool):
    """

    allow_vk: bool
    allow_otel_direct: bool

    def to_dict(self) -> dict[str, Any]:
        allow_vk = self.allow_vk

        allow_otel_direct = self.allow_otel_direct

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "allowVk": allow_vk,
                "allowOtelDirect": allow_otel_direct,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        allow_vk = d.pop("allowVk")

        allow_otel_direct = d.pop("allowOtelDirect")

        read_cli_bootstrap_response_200_tool_policies_code = cls(
            allow_vk=allow_vk,
            allow_otel_direct=allow_otel_direct,
        )

        return read_cli_bootstrap_response_200_tool_policies_code
