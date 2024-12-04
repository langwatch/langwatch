import logging


def get_logger(name: str):
    logger = logging.getLogger(name)

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
