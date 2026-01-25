"""
Integration tests for HTTP node execution.

Scenarios from specs/evaluations-v3/http-agent-support.feature (lines 110-205):
- execute_flow recognizes HTTP node type
- HTTP node makes request with configured method and URL
- HTTP node interpolates inputs into body template
- HTTP node extracts output using JSONPath
- HTTP node applies bearer token authentication
- HTTP node applies API key authentication
- HTTP node applies custom headers
- HTTP node returns error for connection failure
- HTTP node returns error for non-2xx response
- HTTP node returns error when JSONPath finds no match
- HTTP node respects timeout configuration
"""

import pytest
import httpx
from pytest_httpx import HTTPXMock
from typing import Optional, Dict, Any, List

from langwatch_nlp.studio.execute.http_node import (
    HttpNodeConfig,
    HttpAuthConfig,
    execute_http_node,
)
from langwatch_nlp.studio.types.dsl import (
    DatasetInline,
    Edge,
    End,
    EndNode,
    Entry,
    EntryNode,
    Field,
    FieldType,
    Http,
    HttpNode as HttpNodeDSL,
    NodeDataset,
    Workflow,
    WorkflowState,
)
from langwatch_nlp.studio.types.dataset import DatasetColumn, DatasetColumnType
from langwatch_nlp.studio.parser import parse_component, parse_workflow


def build_http_parameters(
    url: str,
    method: str = "POST",
    body_template: Optional[str] = None,
    output_path: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout_ms: Optional[int] = None,
    auth_type: Optional[str] = None,
    auth_token: Optional[str] = None,
    auth_header: Optional[str] = None,
    auth_value: Optional[str] = None,
    auth_username: Optional[str] = None,
    auth_password: Optional[str] = None,
) -> List[Field]:
    """Helper to build HTTP parameters in the standard Field format."""
    params = [
        Field(identifier="url", type=FieldType.str, value=url),
        Field(identifier="method", type=FieldType.str, value=method),
    ]

    if body_template:
        params.append(Field(identifier="body_template", type=FieldType.str, value=body_template))
    if output_path:
        params.append(Field(identifier="output_path", type=FieldType.str, value=output_path))
    if headers:
        params.append(Field(identifier="headers", type=FieldType.dict, value=headers))
    if timeout_ms:
        params.append(Field(identifier="timeout_ms", type=FieldType.int, value=timeout_ms))
    if auth_type:
        params.append(Field(identifier="auth_type", type=FieldType.str, value=auth_type))
    if auth_token:
        params.append(Field(identifier="auth_token", type=FieldType.str, value=auth_token))
    if auth_header:
        params.append(Field(identifier="auth_header", type=FieldType.str, value=auth_header))
    if auth_value:
        params.append(Field(identifier="auth_value", type=FieldType.str, value=auth_value))
    if auth_username:
        params.append(Field(identifier="auth_username", type=FieldType.str, value=auth_username))
    if auth_password:
        params.append(Field(identifier="auth_password", type=FieldType.str, value=auth_password))

    return params


class TestHttpNodeRecognition:
    """execute_flow recognizes HTTP node type (no 'unknown node type' error)"""

    @pytest.mark.integration
    def test_http_node_type_is_valid(self):
        """HTTP node config can be created with valid parameters."""
        config = HttpNodeConfig(
            url="https://api.example.com/v1/chat",
            method="POST",
        )
        assert config.url == "https://api.example.com/v1/chat"
        assert config.method == "POST"

    @pytest.mark.integration
    def test_parser_recognizes_http_node_type(self):
        """Parser returns valid import and class for HTTP node type."""
        node = HttpNodeDSL(
            id="http_node_1",
            data=Http(
                name="MyHttpAgent",
                parameters=build_http_parameters(
                    url="https://api.example.com/v1/chat",
                    method="POST",
                    body_template='{"message": "{{input}}"}',
                    output_path="$.response",
                ),
            ),
        )

        # Should not raise "Unknown node type" error
        import_code, class_name, params = parse_component(node, None, False)

        assert "HttpNode" in import_code
        assert class_name == "HttpNode"
        assert params["url"] == "https://api.example.com/v1/chat"
        assert params["method"] == "POST"
        assert params["body_template"] == '{"message": "{{input}}"}'
        assert params["output_path"] == "$.response"

    @pytest.mark.integration
    def test_parser_includes_auth_params_for_bearer(self):
        """Parser includes auth parameters for bearer token auth."""
        node = HttpNodeDSL(
            id="http_node_auth",
            data=Http(
                name="AuthHttpAgent",
                parameters=build_http_parameters(
                    url="https://api.example.com/v1/chat",
                    method="POST",
                    auth_type="bearer",
                    auth_token="sk-test-12345",  # noqa: S106 (test fake token)
                ),
            ),
        )

        _, _, params = parse_component(node, None, False)

        assert params["auth_type"] == "bearer"
        assert params["auth_token"] == "sk-test-12345"  # noqa: S105 (test fake token)

    @pytest.mark.integration
    def test_parser_includes_auth_params_for_api_key(self):
        """Parser includes auth parameters for API key auth."""
        node = HttpNodeDSL(
            id="http_node_apikey",
            data=Http(
                name="ApiKeyHttpAgent",
                parameters=build_http_parameters(
                    url="https://api.example.com/v1/chat",
                    method="POST",
                    auth_type="api_key",
                    auth_header="X-API-Key",
                    auth_value="my-secret-key",  # noqa: S106 (test fake key)
                ),
            ),
        )

        _, _, params = parse_component(node, None, False)

        assert params["auth_type"] == "api_key"
        assert params["auth_header"] == "X-API-Key"
        assert params["auth_value"] == "my-secret-key"  # noqa: S105 (test fake key)

    @pytest.mark.integration
    def test_workflow_with_http_node_parses_successfully(self):
        """A full workflow with HTTP node can be parsed without errors."""
        workflow = Workflow(
            workflow_id="http-agent-workflow",
            api_key="test-key",
            spec_version="1.3",
            name="HTTP Agent Workflow",
            icon="globe",
            description="Workflow with HTTP agent",
            version="1.0",
            nodes=[
                EntryNode(
                    id="entry",
                    data=Entry(
                        name="Entry",
                        outputs=[
                            Field(identifier="input", type=FieldType.str),
                        ],
                        train_size=0.5,
                        test_size=0.5,
                        seed=42,
                        dataset=NodeDataset(
                            name="Test Dataset",
                            inline=DatasetInline(
                                records={"input": ["Hello"]},
                                columnTypes=[
                                    DatasetColumn(
                                        name="input", type=DatasetColumnType.string
                                    )
                                ],
                            ),
                        ),
                    ),
                ),
                HttpNodeDSL(
                    id="http_agent",
                    data=Http(
                        name="MyHttpAgent",
                        inputs=[
                            Field(identifier="input", type=FieldType.str),
                        ],
                        outputs=[
                            Field(identifier="output", type=FieldType.str),
                        ],
                        parameters=build_http_parameters(
                            url="https://api.example.com/v1/chat",
                            method="POST",
                            body_template='{"message": "{{input}}"}',
                            output_path="$.response",
                        ),
                    ),
                ),
                EndNode(
                    id="end",
                    data=End(
                        name="End",
                        inputs=[
                            Field(identifier="result", type=FieldType.str),
                        ],
                    ),
                ),
            ],
            edges=[
                Edge(
                    id="e1",
                    source="entry",
                    sourceHandle="outputs.input",
                    target="http_agent",
                    targetHandle="inputs.input",
                    type="default",
                ),
                Edge(
                    id="e2",
                    source="http_agent",
                    sourceHandle="outputs.output",
                    target="end",
                    targetHandle="end.result",
                    type="default",
                ),
            ],
            state=WorkflowState(),
            template_adapter="default",
        )

        # Should not raise any errors
        class_name, code, _ = parse_workflow(workflow, format=True)

        assert class_name == "WorkflowModule"
        assert "HttpNode" in code
        assert "https://api.example.com/v1/chat" in code

    @pytest.mark.integration
    def test_parser_with_headers_and_timeout(self):
        """Parser handles headers and timeout parameters."""
        node = HttpNodeDSL(
            id="http_node_full",
            data=Http(
                name="FullHttpAgent",
                parameters=build_http_parameters(
                    url="https://api.example.com/v1/chat",
                    method="POST",
                    body_template='{"message": "{{input}}"}',
                    output_path="$.response.content",
                    headers={"X-Custom": "test-value"},
                    timeout_ms=5000,
                ),
            ),
        )

        import_code, class_name, params = parse_component(node, None, False)

        assert "HttpNode" in import_code
        assert class_name == "HttpNode"
        assert params["url"] == "https://api.example.com/v1/chat"
        assert params["method"] == "POST"
        assert params["body_template"] == '{"message": "{{input}}"}'
        assert params["output_path"] == "$.response.content"
        assert params["timeout_ms"] == 5000
        assert params["headers"] == {"X-Custom": "test-value"}


class TestHttpNodeRequest:
    """HTTP node makes request with configured method and URL"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_makes_post_request_to_configured_url(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            url="https://api.example.com/v1/chat",
            method="POST",
            json={"result": "ok"},
        )

        config = HttpNodeConfig(
            url="https://api.example.com/v1/chat",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        requests = httpx_mock.get_requests()
        assert len(requests) == 1
        assert requests[0].method == "POST"
        assert str(requests[0].url) == "https://api.example.com/v1/chat"

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_makes_get_request_when_configured(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            url="https://api.example.com/status",
            method="GET",
            json={"status": "healthy"},
        )

        config = HttpNodeConfig(
            url="https://api.example.com/status",
            method="GET",
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        requests = httpx_mock.get_requests()
        assert requests[0].method == "GET"


class TestHttpNodeBodyInterpolation:
    """HTTP node interpolates inputs into body template"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_interpolates_single_variable(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            body_template='{"message": "{{input}}"}',
        )
        inputs = {"input": "Hello, world!"}

        result = await execute_http_node(config, inputs)

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        assert request.content == b'{"message": "Hello, world!"}'

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_interpolates_multiple_variables(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            body_template='{"thread_id": "{{thread_id}}", "message": "{{input}}"}',
        )
        inputs = {"thread_id": "abc-123", "input": "Hello, world!"}

        result = await execute_http_node(config, inputs)

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        assert request.content == b'{"thread_id": "abc-123", "message": "Hello, world!"}'

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_escapes_special_chars_in_strings(self, httpx_mock: HTTPXMock):
        """Strings with quotes, newlines, tabs are properly escaped for JSON."""
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            body_template='{"message": "{{input}}"}',
        )
        # Input with quotes, newlines, and tabs
        inputs = {"input": 'hello "world"\nline2\ttab'}

        result = await execute_http_node(config, inputs)

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        # Verify the JSON is valid and properly escaped
        import json
        body = json.loads(request.content)
        assert body["message"] == 'hello "world"\nline2\ttab'

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_interpolates_array_without_escaping(self, httpx_mock: HTTPXMock):
        """Arrays are JSON stringified without extra escaping."""
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            body_template='{"messages": {{messages}}}',
        )
        inputs = {"messages": [{"role": "user", "content": "hi"}]}

        result = await execute_http_node(config, inputs)

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        import json
        body = json.loads(request.content)
        assert body["messages"] == [{"role": "user", "content": "hi"}]

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_interpolates_dict_without_escaping(self, httpx_mock: HTTPXMock):
        """Dicts are JSON stringified without extra escaping."""
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            body_template='{"metadata": {{metadata}}}',
        )
        inputs = {"metadata": {"key": "value", "nested": {"a": 1}}}

        result = await execute_http_node(config, inputs)

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        import json
        body = json.loads(request.content)
        assert body["metadata"] == {"key": "value", "nested": {"a": 1}}

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_handles_missing_variable_gracefully(self, httpx_mock: HTTPXMock):
        """Missing variables render as empty string."""
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            body_template='{"message": "{{input}}", "context": "{{missing}}"}',
        )
        inputs = {"input": "hello"}  # 'missing' is not provided

        result = await execute_http_node(config, inputs)

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        import json
        body = json.loads(request.content)
        assert body["message"] == "hello"
        assert body["context"] == ""


class TestHttpNodeJsonPathExtraction:
    """HTTP node extracts output using JSONPath"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_extracts_nested_value_with_jsonpath(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            json={
                "choices": [
                    {"message": {"content": "Hello! How can I help you?"}}
                ]
            }
        )

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            output_path="$.choices[0].message.content",
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        assert result.output == "Hello! How can I help you?"

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_full_response_when_no_output_path(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"status": "ok", "data": "test"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            output_path=None,  # No output path
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        # When no output_path is specified, the full response is returned as dict
        assert result.output == {"status": "ok", "data": "test"}


class TestHttpNodeBearerAuth:
    """HTTP node applies bearer token authentication"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_applies_bearer_token_header(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            auth=HttpAuthConfig(type="bearer", token="my-secret-token"),  # noqa: S106
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        assert request.headers["Authorization"] == "Bearer my-secret-token"


class TestHttpNodeApiKeyAuth:
    """HTTP node applies API key authentication"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_applies_api_key_header(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            auth=HttpAuthConfig(
                type="api_key", header="X-API-Key", value="my-api-key"  # noqa: S106
            ),
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        assert request.headers["X-API-Key"] == "my-api-key"


class TestHttpNodeCustomHeaders:
    """HTTP node applies custom headers"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_applies_custom_headers(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            headers={"X-Custom-Header": "custom-value", "X-Another": "another-value"},
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        assert request.headers["X-Custom-Header"] == "custom-value"
        assert request.headers["X-Another"] == "another-value"


class TestHttpNodeConnectionError:
    """HTTP node returns error for connection failure"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_for_connection_failure(self, httpx_mock: HTTPXMock):
        httpx_mock.add_exception(httpx.ConnectError("Connection refused"))

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "Connection refused" in (result.error or "")


class TestHttpNodeNon2xxResponse:
    """HTTP node returns error for non-2xx response"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_for_401_unauthorized(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(status_code=401, json={"error": "Unauthorized"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "401" in (result.error or "")

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_for_500_server_error(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(status_code=500, json={"error": "Internal Server Error"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "500" in (result.error or "")


class TestHttpNodeJsonPathError:
    """HTTP node returns error when JSONPath finds no match"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_for_jsonpath_no_match(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"different": "structure"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            output_path="$.nonexistent.path",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "JSONPath" in (result.error or "") or "no match" in (result.error or "").lower()


class TestHttpNodeTimeout:
    """HTTP node respects timeout configuration"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_on_timeout(self, httpx_mock: HTTPXMock):
        httpx_mock.add_exception(httpx.TimeoutException("Request timed out"))

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            timeout_ms=1000,
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "timeout" in (result.error or "").lower()

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_uses_configured_timeout(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            timeout_ms=5000,
        )
        # This test mainly verifies the timeout_ms parameter is accepted
        result = await execute_http_node(config, {})

        assert result.success is True


class TestHttpNodeSsrfProtection:
    """HTTP node blocks requests to localhost and internal networks (SSRF protection)"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_blocks_localhost(self, monkeypatch):
        """Blocks requests to localhost."""
        # Clear any ALLOWED_PROXY_HOSTS from .env
        monkeypatch.delenv("ALLOWED_PROXY_HOSTS", raising=False)

        config = HttpNodeConfig(
            url="http://localhost:8000/api",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "Blocked URL" in (result.error or "")

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_blocks_127_0_0_1(self, monkeypatch):
        """Blocks requests to 127.0.0.1."""
        monkeypatch.delenv("ALLOWED_PROXY_HOSTS", raising=False)

        config = HttpNodeConfig(
            url="http://127.0.0.1:8000/api",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "Blocked URL" in (result.error or "")

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_blocks_private_ip_10_network(self, monkeypatch):
        """Blocks requests to 10.x.x.x private network."""
        monkeypatch.delenv("ALLOWED_PROXY_HOSTS", raising=False)

        config = HttpNodeConfig(
            url="http://10.0.0.5:8000/api",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "Blocked URL" in (result.error or "")

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_blocks_private_ip_192_168_network(self, monkeypatch):
        """Blocks requests to 192.168.x.x private network."""
        monkeypatch.delenv("ALLOWED_PROXY_HOSTS", raising=False)

        config = HttpNodeConfig(
            url="http://192.168.1.100:8000/api",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "Blocked URL" in (result.error or "")

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_blocks_private_ip_172_network(self, monkeypatch):
        """Blocks requests to 172.16-31.x.x private network."""
        monkeypatch.delenv("ALLOWED_PROXY_HOSTS", raising=False)

        config = HttpNodeConfig(
            url="http://172.16.0.5:8000/api",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "Blocked URL" in (result.error or "")

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_blocks_metadata_endpoint(self, monkeypatch):
        """Always blocks cloud metadata endpoint."""
        monkeypatch.delenv("ALLOWED_PROXY_HOSTS", raising=False)

        config = HttpNodeConfig(
            url="http://169.254.169.254/latest/meta-data/",
            method="GET",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "Blocked URL" in (result.error or "")

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_allows_localhost_when_in_allowed_hosts(self, monkeypatch, httpx_mock: HTTPXMock):
        """Allows localhost when listed in ALLOWED_PROXY_HOSTS env var."""
        monkeypatch.setenv("ALLOWED_PROXY_HOSTS", "localhost")
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="http://localhost:8000/api",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is True

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_allows_multiple_hosts_in_allowed_list(self, monkeypatch, httpx_mock: HTTPXMock):
        """Allows multiple hosts when comma-separated in ALLOWED_PROXY_HOSTS."""
        monkeypatch.setenv("ALLOWED_PROXY_HOSTS", "localhost,127.0.0.1,api.local")
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="http://127.0.0.1:8000/api",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is True

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_metadata_always_blocked_even_with_allowed_hosts(self, monkeypatch):
        """Metadata endpoints are ALWAYS blocked even when in allowed hosts."""
        monkeypatch.setenv("ALLOWED_PROXY_HOSTS", "169.254.169.254")

        config = HttpNodeConfig(
            url="http://169.254.169.254/latest/meta-data/",
            method="GET",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert "Blocked URL" in (result.error or "")
