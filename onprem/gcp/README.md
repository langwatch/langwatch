# LangWatch GCP Infrastructure

This directory contains Terraform configurations to deploy LangWatch infrastructure on Google Cloud Platform.

## Prerequisites

- [Terraform](https://www.terraform.io/downloads.html) installed
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed
- Google Cloud Project with necessary APIs enabled
- Authenticated gcloud CLI

## Authentication

1. Install the Google Cloud SDK:
   ```bash
   # For macOS with Homebrew
   brew install google-cloud-sdk

   # For other systems, follow the installation guide:
   # https://cloud.google.com/sdk/docs/install
   ```

2. Initialize the Google Cloud SDK:
   ```bash
   gcloud init
   ```

3. Set your default region and zone:
   ```bash
   # Set default region
   gcloud config set compute/region europe-west3

   # Set default zone
   gcloud config set compute/zone europe-west3-a

   # Verify your configuration
   gcloud config list
   ```

4. Authenticate with Google Cloud:
   ```bash
   gcloud auth application-default login
   ```

5. Enable required APIs:
   ```bash
   # Enable required GCP APIs
   gcloud services enable \
     compute.googleapis.com \
     servicenetworking.googleapis.com \
     cloudkms.googleapis.com \
     redis.googleapis.com \
     sqladmin.googleapis.com \
     secretmanager.googleapis.com \
     vpcaccess.googleapis.com
   ```

## Usage

1. Initialize Terraform:
   ```bash
   make init PROJECT_ID=your-project-id REGION=europe-west3 ZONE=europe-west3-a
   ```

2. Preview changes:
   ```bash
   make plan PROJECT_ID=your-project-id REGION=europe-west3 ZONE=europe-west3-a
   ```

3. Apply changes:
   ```bash
   make apply PROJECT_ID=your-project-id REGION=europe-west3 ZONE=europe-west3-a
   ```
