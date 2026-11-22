from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ApplySuiteTemplateBodyFit")


@_attrs_define
class ApplySuiteTemplateBodyFit:
    """
    Attributes:
        agent_name (str):
        tools (list[str] | Unset):
        must_never (list[str] | Unset):
    """

    agent_name: str
    tools: list[str] | Unset = UNSET
    must_never: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        agent_name = self.agent_name

        tools: list[str] | Unset = UNSET
        if not isinstance(self.tools, Unset):
            tools = self.tools

        must_never: list[str] | Unset = UNSET
        if not isinstance(self.must_never, Unset):
            must_never = self.must_never

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "agentName": agent_name,
            }
        )
        if tools is not UNSET:
            field_dict["tools"] = tools
        if must_never is not UNSET:
            field_dict["mustNever"] = must_never

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        agent_name = d.pop("agentName")

        tools = cast(list[str], d.pop("tools", UNSET))

        must_never = cast(list[str], d.pop("mustNever", UNSET))

        apply_suite_template_body_fit = cls(
            agent_name=agent_name,
            tools=tools,
            must_never=must_never,
        )

        return apply_suite_template_body_fit
