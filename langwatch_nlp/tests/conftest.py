"""
Pytest configuration for langwatch_nlp tests.

This module handles environment setup for both local development (with .env files)
and CI environments (with GitHub Actions secrets).
"""
import os
from dotenv import load_dotenv

# Load .env file if it exists (for local development)
# In CI, environment variables are passed directly via GitHub Actions
load_dotenv()

