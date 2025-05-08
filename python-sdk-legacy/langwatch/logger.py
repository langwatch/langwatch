import logging
import langwatch


def get_logger():
    logger = logging.getLogger("LangWatch")
    logger.propagate = False

    if langwatch.debug:
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
