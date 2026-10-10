from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.read_cli_bootstrap_response_200_budget import ReadCliBootstrapResponse200Budget
    from ..models.read_cli_bootstrap_response_200_providers_item import ReadCliBootstrapResponse200ProvidersItem
    from ..models.read_cli_bootstrap_response_200_tool_policies import ReadCliBootstrapResponse200ToolPolicies
    from ..models.read_cli_bootstrap_response_200_tools_item import ReadCliBootstrapResponse200ToolsItem


T = TypeVar("T", bound="ReadCliBootstrapResponse200")


@_attrs_define
class ReadCliBootstrapResponse200:
    """
    Attributes:
        tools (list[ReadCliBootstrapResponse200ToolsItem]):
        providers (list[ReadCliBootstrapResponse200ProvidersItem]):
        gateway_providers (list[str]):
        budget (ReadCliBootstrapResponse200Budget):
        gateway_url (str):
        admin_email (None | str):
        tool_policies (ReadCliBootstrapResponse200ToolPolicies):
    """

    tools: list[ReadCliBootstrapResponse200ToolsItem]
    providers: list[ReadCliBootstrapResponse200ProvidersItem]
    gateway_providers: list[str]
    budget: ReadCliBootstrapResponse200Budget
    gateway_url: str
    admin_email: None | str
    tool_policies: ReadCliBootstrapResponse200ToolPolicies

    def to_dict(self) -> dict[str, Any]:
        tools = []
        for tools_item_data in self.tools:
            tools_item = tools_item_data.to_dict()
            tools.append(tools_item)

        providers = []
        for providers_item_data in self.providers:
            providers_item = providers_item_data.to_dict()
            providers.append(providers_item)

        gateway_providers = self.gateway_providers

        budget = self.budget.to_dict()

        gateway_url = self.gateway_url

        admin_email: None | str
        admin_email = self.admin_email

        tool_policies = self.tool_policies.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "tools": tools,
                "providers": providers,
                "gatewayProviders": gateway_providers,
                "budget": budget,
                "gatewayUrl": gateway_url,
                "adminEmail": admin_email,
                "toolPolicies": tool_policies,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.read_cli_bootstrap_response_200_budget import ReadCliBootstrapResponse200Budget
        from ..models.read_cli_bootstrap_response_200_providers_item import ReadCliBootstrapResponse200ProvidersItem
        from ..models.read_cli_bootstrap_response_200_tool_policies import ReadCliBootstrapResponse200ToolPolicies
        from ..models.read_cli_bootstrap_response_200_tools_item import ReadCliBootstrapResponse200ToolsItem

        d = dict(src_dict)
        tools = []
        _tools = d.pop("tools")
        for tools_item_data in _tools:
            tools_item = ReadCliBootstrapResponse200ToolsItem.from_dict(tools_item_data)

            tools.append(tools_item)

        providers = []
        _providers = d.pop("providers")
        for providers_item_data in _providers:
            providers_item = ReadCliBootstrapResponse200ProvidersItem.from_dict(providers_item_data)

            providers.append(providers_item)

        gateway_providers = cast(list[str], d.pop("gatewayProviders"))

        budget = ReadCliBootstrapResponse200Budget.from_dict(d.pop("budget"))

        gateway_url = d.pop("gatewayUrl")

        def _parse_admin_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        admin_email = _parse_admin_email(d.pop("adminEmail"))

        tool_policies = ReadCliBootstrapResponse200ToolPolicies.from_dict(d.pop("toolPolicies"))

        read_cli_bootstrap_response_200 = cls(
            tools=tools,
            providers=providers,
            gateway_providers=gateway_providers,
            budget=budget,
            gateway_url=gateway_url,
            admin_email=admin_email,
            tool_policies=tool_policies,
        )

        return read_cli_bootstrap_response_200
