from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.read_cli_bootstrap_response_200_tool_policies_claude import (
        ReadCliBootstrapResponse200ToolPoliciesClaude,
    )
    from ..models.read_cli_bootstrap_response_200_tool_policies_code import ReadCliBootstrapResponse200ToolPoliciesCode
    from ..models.read_cli_bootstrap_response_200_tool_policies_codex import (
        ReadCliBootstrapResponse200ToolPoliciesCodex,
    )
    from ..models.read_cli_bootstrap_response_200_tool_policies_copilot import (
        ReadCliBootstrapResponse200ToolPoliciesCopilot,
    )
    from ..models.read_cli_bootstrap_response_200_tool_policies_cursor import (
        ReadCliBootstrapResponse200ToolPoliciesCursor,
    )
    from ..models.read_cli_bootstrap_response_200_tool_policies_gemini import (
        ReadCliBootstrapResponse200ToolPoliciesGemini,
    )
    from ..models.read_cli_bootstrap_response_200_tool_policies_opencode import (
        ReadCliBootstrapResponse200ToolPoliciesOpencode,
    )


T = TypeVar("T", bound="ReadCliBootstrapResponse200ToolPolicies")


@_attrs_define
class ReadCliBootstrapResponse200ToolPolicies:
    """
    Attributes:
        claude (ReadCliBootstrapResponse200ToolPoliciesClaude):
        codex (ReadCliBootstrapResponse200ToolPoliciesCodex):
        gemini (ReadCliBootstrapResponse200ToolPoliciesGemini):
        opencode (ReadCliBootstrapResponse200ToolPoliciesOpencode):
        cursor (ReadCliBootstrapResponse200ToolPoliciesCursor):
        copilot (ReadCliBootstrapResponse200ToolPoliciesCopilot):
        code (ReadCliBootstrapResponse200ToolPoliciesCode):
    """

    claude: ReadCliBootstrapResponse200ToolPoliciesClaude
    codex: ReadCliBootstrapResponse200ToolPoliciesCodex
    gemini: ReadCliBootstrapResponse200ToolPoliciesGemini
    opencode: ReadCliBootstrapResponse200ToolPoliciesOpencode
    cursor: ReadCliBootstrapResponse200ToolPoliciesCursor
    copilot: ReadCliBootstrapResponse200ToolPoliciesCopilot
    code: ReadCliBootstrapResponse200ToolPoliciesCode

    def to_dict(self) -> dict[str, Any]:
        claude = self.claude.to_dict()

        codex = self.codex.to_dict()

        gemini = self.gemini.to_dict()

        opencode = self.opencode.to_dict()

        cursor = self.cursor.to_dict()

        copilot = self.copilot.to_dict()

        code = self.code.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "claude": claude,
                "codex": codex,
                "gemini": gemini,
                "opencode": opencode,
                "cursor": cursor,
                "copilot": copilot,
                "code": code,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.read_cli_bootstrap_response_200_tool_policies_claude import (
            ReadCliBootstrapResponse200ToolPoliciesClaude,
        )
        from ..models.read_cli_bootstrap_response_200_tool_policies_code import (
            ReadCliBootstrapResponse200ToolPoliciesCode,
        )
        from ..models.read_cli_bootstrap_response_200_tool_policies_codex import (
            ReadCliBootstrapResponse200ToolPoliciesCodex,
        )
        from ..models.read_cli_bootstrap_response_200_tool_policies_copilot import (
            ReadCliBootstrapResponse200ToolPoliciesCopilot,
        )
        from ..models.read_cli_bootstrap_response_200_tool_policies_cursor import (
            ReadCliBootstrapResponse200ToolPoliciesCursor,
        )
        from ..models.read_cli_bootstrap_response_200_tool_policies_gemini import (
            ReadCliBootstrapResponse200ToolPoliciesGemini,
        )
        from ..models.read_cli_bootstrap_response_200_tool_policies_opencode import (
            ReadCliBootstrapResponse200ToolPoliciesOpencode,
        )

        d = dict(src_dict)
        claude = ReadCliBootstrapResponse200ToolPoliciesClaude.from_dict(d.pop("claude"))

        codex = ReadCliBootstrapResponse200ToolPoliciesCodex.from_dict(d.pop("codex"))

        gemini = ReadCliBootstrapResponse200ToolPoliciesGemini.from_dict(d.pop("gemini"))

        opencode = ReadCliBootstrapResponse200ToolPoliciesOpencode.from_dict(d.pop("opencode"))

        cursor = ReadCliBootstrapResponse200ToolPoliciesCursor.from_dict(d.pop("cursor"))

        copilot = ReadCliBootstrapResponse200ToolPoliciesCopilot.from_dict(d.pop("copilot"))

        code = ReadCliBootstrapResponse200ToolPoliciesCode.from_dict(d.pop("code"))

        read_cli_bootstrap_response_200_tool_policies = cls(
            claude=claude,
            codex=codex,
            gemini=gemini,
            opencode=opencode,
            cursor=cursor,
            copilot=copilot,
            code=code,
        )

        return read_cli_bootstrap_response_200_tool_policies
