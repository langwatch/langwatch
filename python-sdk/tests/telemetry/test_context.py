import unittest
from unittest.mock import patch, MagicMock

from langwatch.telemetry import context as telemetry_context
from langwatch.telemetry.span import LangWatchSpan
from langwatch.telemetry.tracing import LangWatchTrace


class TestContext(unittest.TestCase):
    def setUp(self):
        # Reset contextvars before each test
        self.trace_token = telemetry_context.stored_langwatch_trace.set(None)  # type: ignore
        self.span_token = telemetry_context.stored_langwatch_span.set(None)  # type: ignore

    def tearDown(self):
        telemetry_context.stored_langwatch_trace.reset(self.trace_token)
        telemetry_context.stored_langwatch_span.reset(self.span_token)

    @patch("langwatch.telemetry.context.ensure_setup")
    def test_get_current_trace_exists(self, mock_ensure_setup: MagicMock):
        mock_trace = MagicMock(spec=LangWatchTrace)
        telemetry_context.stored_langwatch_trace.set(mock_trace)
        trace = telemetry_context.get_current_trace()
        self.assertIs(trace, mock_trace)
        mock_ensure_setup.assert_called_once()

    @patch("langwatch.telemetry.context.warnings.warn")
    @patch("langwatch.telemetry.context.ensure_setup")
    @patch("langwatch.telemetry.tracing.LangWatchTrace")
    def test_get_current_trace_not_exists_warning(
        self,
        mock_lw_trace_constructor: MagicMock,
        mock_ensure_setup: MagicMock,
        mock_warn: MagicMock,
    ):
        mock_trace_instance = MagicMock(spec=LangWatchTrace)
        mock_lw_trace_constructor.return_value = mock_trace_instance

        trace = telemetry_context.get_current_trace()

        self.assertIs(trace, mock_trace_instance)
        mock_ensure_setup.assert_called_once()
        mock_warn.assert_called_once_with(
            "No trace in context when calling langwatch.get_current_trace(), perhaps you forgot to use @langwatch.trace()?",
        )
        mock_lw_trace_constructor.assert_called_once()

    @patch("langwatch.telemetry.context.warnings.warn")
    @patch("langwatch.telemetry.context.ensure_setup")
    @patch("langwatch.telemetry.tracing.LangWatchTrace")
    def test_get_current_trace_not_exists_warning_start_if_none(
        self,
        mock_lw_trace_constructor: MagicMock,
        mock_ensure_setup: MagicMock,
        mock_warn: MagicMock,
    ):
        mock_trace_instance = MagicMock(spec=LangWatchTrace)
        mock_lw_trace_constructor.return_value.__enter__.return_value = (
            mock_trace_instance
        )

        trace = telemetry_context.get_current_trace(start_if_none=True)

        self.assertIs(trace, mock_trace_instance)
        mock_ensure_setup.assert_called_once()
        mock_warn.assert_called_once_with(
            "No trace in context when calling langwatch.get_current_trace(), perhaps you forgot to use @langwatch.trace()?",
        )
        mock_lw_trace_constructor.assert_called_once()
        mock_lw_trace_constructor.return_value.__enter__.assert_called_once()

    @patch("langwatch.telemetry.context.warnings.warn")
    @patch("langwatch.telemetry.context.ensure_setup")
    @patch("langwatch.telemetry.tracing.LangWatchTrace")
    def test_get_current_trace_not_exists_suppress_warning(
        self,
        mock_lw_trace_constructor: MagicMock,
        mock_ensure_setup: MagicMock,
        mock_warn: MagicMock,
    ):
        mock_trace_instance = MagicMock(spec=LangWatchTrace)
        mock_lw_trace_constructor.return_value = mock_trace_instance

        trace = telemetry_context.get_current_trace(suppress_warning=True)

        self.assertIs(trace, mock_trace_instance)
        mock_ensure_setup.assert_called_once()
        mock_warn.assert_not_called()
        mock_lw_trace_constructor.assert_called_once()

    @patch("langwatch.telemetry.context.ensure_setup")
    def test_get_current_span_exists_in_lw_context(self, mock_ensure_setup: MagicMock):
        mock_span = MagicMock(spec=LangWatchSpan)
        telemetry_context.stored_langwatch_span.set(mock_span)
        span = telemetry_context.get_current_span()
        self.assertIs(span, mock_span)
        mock_ensure_setup.assert_called_once()

    @patch("langwatch.telemetry.context.trace_api.get_current_span")
    @patch("langwatch.telemetry.context.ensure_setup")
    @patch("langwatch.telemetry.span.LangWatchSpan.wrap_otel_span")
    def test_get_current_span_exists_in_otel_context(
        self,
        mock_wrap_otel_span: MagicMock,
        mock_ensure_setup: MagicMock,
        mock_otel_get_current_span: MagicMock,
    ):
        mock_otel_span = MagicMock()
        mock_otel_get_current_span.return_value = mock_otel_span
        mock_lw_span = MagicMock(spec=LangWatchSpan)
        mock_wrap_otel_span.return_value = mock_lw_span

        # Mock get_current_trace to avoid its side effects/warnings
        with patch(
            "langwatch.telemetry.context.get_current_trace"
        ) as mock_get_current_trace:
            mock_current_trace = MagicMock(spec=LangWatchTrace)
            mock_get_current_trace.return_value = mock_current_trace

            span = telemetry_context.get_current_span()

            self.assertIs(span, mock_lw_span)
            mock_ensure_setup.assert_called_once()
            mock_otel_get_current_span.assert_called_once()
            mock_get_current_trace.assert_called_once()
            mock_wrap_otel_span.assert_called_once_with(
                mock_otel_span, mock_current_trace
            )

    @patch("langwatch.telemetry.context.trace_api.get_current_span")
    @patch("langwatch.telemetry.context.ensure_setup")
    @patch("langwatch.telemetry.span.LangWatchSpan.wrap_otel_span")
    @patch("langwatch.telemetry.context.get_current_trace")
    def test_get_current_span_not_exists_anywhere(
        self,
        mock_get_current_trace: MagicMock,
        mock_wrap_otel_span: MagicMock,
        mock_ensure_setup: MagicMock,
        mock_otel_get_current_span: MagicMock,
    ):
        mock_otel_span = MagicMock()  # represents a non-recording span
        mock_otel_get_current_span.return_value = mock_otel_span
        mock_lw_span = MagicMock(spec=LangWatchSpan)
        mock_wrap_otel_span.return_value = mock_lw_span
        mock_current_trace = MagicMock(spec=LangWatchTrace)
        mock_get_current_trace.return_value = mock_current_trace

        span = telemetry_context.get_current_span()

        self.assertIs(span, mock_lw_span)
        mock_ensure_setup.assert_called_once()
        mock_otel_get_current_span.assert_called_once()
        mock_get_current_trace.assert_called_once()  # Called because LW span not in context
        mock_wrap_otel_span.assert_called_once_with(mock_otel_span, mock_current_trace)


if __name__ == "__main__":
    unittest.main()
