"""Connect the function that runs your agent to LangWatch Agent Testing.

    import langwatch

    @langwatch.connect_agent(name="support-agent")
    def support_agent(messages: list[langwatch.Message], plan: str = "free") -> str:
        ...

    langwatch.agent.serve()

See ADR-128 and `specs/python-sdk/agent-decorator.feature`.
"""

from .client import AgentClient, default_client, serve
from .decorator import AgentCall, AgentReply, ConnectedAgent, connect_agent
from .protocol import PROTOCOL_VERSION, Message
from .schema import AgentParameterInvalid, Param

__all__ = [
    "PROTOCOL_VERSION",
    "AgentCall",
    "AgentClient",
    "AgentParameterInvalid",
    "AgentReply",
    "ConnectedAgent",
    "Message",
    "Param",
    "connect_agent",
    "default_client",
    "serve",
]
