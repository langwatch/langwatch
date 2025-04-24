import logging

from ..state import get_instance


def get_logger():
    logger = logging.getLogger("LangWatch")
    logger.propagate = False

    instance = get_instance()

    if instance is not None and instance.debug:
        logger.setLevel(logging.DEBUG)
    else:
        logger.setLevel(logging.INFO)

    if logger.handlers:
        logger.handlers.clear()

    if not logger.handlers:
        console_handler = logging.StreamHandler()
        formatter = logging.Formatter(
            "%(asctime)s - [%(name)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        )
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

    return logger
