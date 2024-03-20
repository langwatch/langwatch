FROM python:3.11-slim

WORKDIR /usr/src/app

RUN pip install poetry

# Install dependencies
COPY poetry.toml poetry.lock pyproject.toml .
RUN poetry install

# Copy the source code
COPY . .

EXPOSE 8080

# Run the application
CMD poetry run hypercorn langwatch_nlp.main:app --bind :8080
