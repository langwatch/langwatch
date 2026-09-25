"""The Linux server's gunicorn settings, applied to gunicorn's real Config.

The chart runs langevals on a read-only root filesystem with HOME=/, and
gunicorn 25.1+ opens a control socket under $HOME/.gunicorn by default, which
logged a Read-only file system error on every boot.
"""

from gunicorn.config import Config

from langevals.utils import gunicorn_options


def apply(options: dict) -> Config:
    config = Config()
    for key, value in options.items():
        config.set(key, value)
    return config


def test_every_option_is_a_gunicorn_setting():
    options = gunicorn_options("0.0.0.0", 5562, 2)

    assert set(options) <= set(Config().settings)


def test_the_control_socket_is_disabled():
    config = apply(gunicorn_options("0.0.0.0", 5562, 2))

    assert config.control_socket_disable is True


def test_bind_and_workers_follow_the_arguments():
    config = apply(gunicorn_options("0.0.0.0", 5562, 3))

    assert config.bind == ["0.0.0.0:5562"]
    assert config.workers == 3
