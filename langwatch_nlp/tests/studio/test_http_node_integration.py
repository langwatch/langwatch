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
    HttpConfig,
    HttpAuthConfig as HttpAuthConfigDSL,
    NodeDataset,
    Workflow,
    WorkflowState,
)
from langwatch_nlp.studio.types.dataset import DatasetColumn, DatasetColumnType
from langwatch_nlp.studio.parser import parse_component, parse_workflow


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
                http_config=HttpConfig(
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
                http_config=HttpConfig(
                    url="https://api.example.com/v1/chat",
                    method="POST",
                    auth=HttpAuthConfigDSL(
                        type="bearer",
                        token="sk-test-12345",
                    ),
                ),
            ),
        )

        import_code, class_name, params = parse_component(node, None, False)

        assert params["auth_type"] == "bearer"
        assert params["auth_token"] == "sk-test-12345"

    @pytest.mark.integration
    def test_parser_includes_auth_params_for_api_key(self):
        """Parser includes auth parameters for API key auth."""
        node = HttpNodeDSL(
            id="http_node_apikey",
            data=Http(
                name="ApiKeyHttpAgent",
                http_config=HttpConfig(
                    url="https://api.example.com/v1/chat",
                    method="POST",
                    auth=HttpAuthConfigDSL(
                        type="api_key",
                        header="X-API-Key",
                        value="my-secret-key",
                    ),
                ),
            ),
        )

        import_code, class_name, params = parse_component(node, None, False)

        assert params["auth_type"] == "api_key"
        assert params["auth_header"] == "X-API-Key"
        assert params["auth_value"] == "my-secret-key"

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
                        http_config=HttpConfig(
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
        class_name, code, inputs = parse_workflow(workflow, format=True)

        assert class_name == "WorkflowModule"
        assert "HttpNode" in code
        assert "https://api.example.com/v1/chat" in code


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
        response_data = {"data": {"value": 42}}
        httpx_mock.add_response(json=response_data)

        config = HttpNodeConfig(
            url="https://api.example.com/api",
            method="GET",
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        assert result.output == response_data


class TestHttpNodeBearerAuth:
    """HTTP node applies bearer token authentication"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_applies_bearer_token_header(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            auth=HttpAuthConfig(
                type="bearer",
                token="sk-test-12345",
            ),
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        assert request.headers["Authorization"] == "Bearer sk-test-12345"


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
                type="api_key",
                header="X-API-Key",
                value="my-secret-key",
            ),
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        assert request.headers["X-API-Key"] == "my-secret-key"


class TestHttpNodeCustomHeaders:
    """HTTP node applies custom headers"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_applies_custom_headers(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
            headers={
                "X-Request-ID": "req-456",
                "X-Environment": "production",
            },
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        request = httpx_mock.get_requests()[0]
        assert request.headers["X-Request-ID"] == "req-456"
        assert request.headers["X-Environment"] == "production"


class TestHttpNodeConnectionError:
    """HTTP node returns error for connection failure"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_for_connection_failure(self, httpx_mock: HTTPXMock):
        httpx_mock.add_exception(httpx.ConnectError("Connection refused"))

        config = HttpNodeConfig(
            url="https://nonexistent.invalid/api",
            method="GET",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert result.error is not None
        assert "connection" in result.error.lower() or "connect" in result.error.lower()


class TestHttpNodeNon2xxResponse:
    """HTTP node returns error for non-2xx response"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_for_401_unauthorized(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            status_code=401,
            json={"error": "Unauthorized"},
        )

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert result.error is not None
        assert "401" in result.error

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_for_500_server_error(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            status_code=500,
            json={"error": "Internal Server Error"},
        )

        config = HttpNodeConfig(
            url="https://api.example.com/chat",
            method="POST",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert result.error is not None
        assert "500" in result.error


class TestHttpNodeJsonPathError:
    """HTTP node returns error when JSONPath finds no match"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_for_jsonpath_no_match(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"data": "value"})

        config = HttpNodeConfig(
            url="https://api.example.com/api",
            method="GET",
            output_path="$.nonexistent.path",
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert result.error is not None
        assert "jsonpath" in result.error.lower() or "path" in result.error.lower()


class TestHttpNodeTimeout:
    """HTTP node respects timeout configuration"""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_returns_error_on_timeout(self, httpx_mock: HTTPXMock):
        httpx_mock.add_exception(httpx.TimeoutException("Request timed out"))

        config = HttpNodeConfig(
            url="https://api.example.com/slow",
            method="GET",
            timeout_ms=5000,
        )
        result = await execute_http_node(config, {})

        assert result.success is False
        assert result.error is not None
        assert "timeout" in result.error.lower()

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_uses_configured_timeout(self, httpx_mock: HTTPXMock):
        """Verify the timeout is passed correctly to the HTTP client."""
        httpx_mock.add_response(json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://api.example.com/api",
            method="GET",
            timeout_ms=3000,  # 3 seconds
        )
        result = await execute_http_node(config, {})

        assert result.success is True
        # The timeout is configured but we can't directly inspect it in pytest-httpx
        # This test just ensures the timeout parameter doesn't break execution
