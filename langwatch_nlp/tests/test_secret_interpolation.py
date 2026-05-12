import pytest
from langwatch_nlp.studio.utils import build_secrets_preamble


class TestBuildSecretsPreamble:
    class TestWhenSecretsAreProvided:
        def test_generates_namespace_with_secret_values(self):
            preamble = build_secrets_preamble({"MY_API_KEY": "key_789"})
            assert "from types import SimpleNamespace as _SecretsNS" in preamble
            assert "secrets = _SecretsNS(" in preamble
            assert "MY_API_KEY='key_789'" in preamble

        def test_generates_multiple_secrets(self):
            preamble = build_secrets_preamble(
                {"KEY_A": "val_a", "KEY_B": "val_b"}
            )
            assert "KEY_A='val_a'" in preamble
            assert "KEY_B='val_b'" in preamble

    class TestWhenSecretsContainSpecialCharacters:
        def test_escapes_quotes_via_repr(self):
            preamble = build_secrets_preamble(
                {"TRICKY": 'has "double" and \'single\' quotes'}
            )
            # repr() will properly escape quotes
            assert "TRICKY=" in preamble
            # The value should be a valid Python literal (repr handles escaping)
            exec_globals: dict = {}
            exec(preamble, exec_globals)
            assert exec_globals["secrets"].TRICKY == 'has "double" and \'single\' quotes'

        def test_escapes_newlines_and_control_characters(self):
            preamble = build_secrets_preamble(
                {"CTRL": "line1\nline2\rline3\0end"}
            )
            exec_globals: dict = {}
            exec(preamble, exec_globals)
            assert exec_globals["secrets"].CTRL == "line1\nline2\rline3\0end"

        def test_escapes_backslashes(self):
            preamble = build_secrets_preamble(
                {"SLASH": "path\\to\\file"}
            )
            exec_globals: dict = {}
            exec(preamble, exec_globals)
            assert exec_globals["secrets"].SLASH == "path\\to\\file"

    class TestWhenSecretsAreNone:
        def test_returns_empty_string(self):
            assert build_secrets_preamble(None) == ""

    class TestWhenSecretsAreEmpty:
        def test_returns_empty_string(self):
            assert build_secrets_preamble({}) == ""

    class TestWhenPreambleIsPrependedToCode:
        def test_secrets_are_accessible_as_attributes(self):
            preamble = build_secrets_preamble(
                {"OPENAI_API_KEY": "sk-test123", "DB_URL": "postgres://localhost"}
            )
            code = preamble + "result = secrets.OPENAI_API_KEY + ' ' + secrets.DB_URL\n"
            exec_globals: dict = {}
            exec(code, exec_globals)
            assert exec_globals["result"] == "sk-test123 postgres://localhost"

        def test_missing_secret_raises_attribute_error(self):
            preamble = build_secrets_preamble({"EXISTING": "value"})
            code = preamble + "x = secrets.MISSING\n"
            with pytest.raises(AttributeError):
                exec(code, {})
