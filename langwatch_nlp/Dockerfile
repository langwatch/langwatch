FROM python:3.11-slim

# Make directory for application
WORKDIR /app

RUN pip install poetry

# Install dependencies
COPY poetry.toml poetry.lock pyproject.toml .
RUN poetry install

# Copy the source code
COPY . .

EXPOSE 8080

# Run the application
CMD cd langwatch_nlp && poetry run hypercorn main:app --bind :8080
