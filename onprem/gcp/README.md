# LangWatch GCP Infrastructure

This directory contains Terraform configurations to deploy LangWatch infrastructure on Google Cloud Platform.

## Prerequisites

- [Terraform](https://www.terraform.io/downloads.html) installed
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed
- Google Cloud Project with necessary APIs enabled
- Authenticated gcloud CLI
- Elasticsearch/OpenSearch cluster (Required)

### Elasticsearch Setup (Required)

LangWatch requires an Elasticsearch/OpenSearch cluster for data storage and search functionality. Before proceeding with the deployment:

1. Create an Elasticsearch cluster:
   - Go to [Elastic Cloud on Google Cloud](https://cloud.google.com/elastic) or your preferred Elasticsearch provider
   - Create a new deployment (recommended version: 8.x, storage optimized, 45GB storage, 2 zones, Search deployment)
   - After deployment is ready, click continue, and save the Elasticsearch endpoint
   - Near (0 active keys), click on (+) New and create a new API key that never expires
   - Copy the "encoded" api key

3. Have these values ready for deployment:
   - Elasticsearch URL (e.g., "https://your-elasticsearch-host:9200")
   - Elasticsearch API key with full permission

4. Proceed with the deployment steps below

5. (Optional) Add a Private Service Connect between your Elasticsearch VPC and the GCP VPC for enhanced security

   Follow this guide: https://www.elastic.co/blog/secure-your-deployments-on-elastic-cloud-with-google-cloud-private-service-connect

6. (Optional) Test connectivity:
   ```bash
   # After deploying the cluster, you can test connectivity from a pod:
   kubectl run curl --image=curlimages/curl -i --tty -- sh
   curl -v -H "Authorization: ApiKey your-api-key" https://your-elasticsearch-host:9200
   ```

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
   make init \
     PROJECT_ID=your-project-id \
     REGION=europe-west3 \
     ZONE=europe-west3-b \
     elasticsearch_url="https://your-elasticsearch-host:9200" \
     elasticsearch_api_key="your-api-key" \
     domain="langwatch.yourdomain.com"
   ```

2. Preview changes:
   ```bash
   make plan \
     PROJECT_ID=your-project-id \
     REGION=europe-west3 \
     ZONE=europe-west3-b \
     elasticsearch_url="https://your-elasticsearch-host:9200" \
     elasticsearch_api_key="your-api-key" \
     domain="langwatch.yourdomain.com"
   ```

3. Apply changes:
   ```bash
   make apply \
     PROJECT_ID=your-project-id \
     REGION=europe-west3 \
     ZONE=europe-west3-b \
     elasticsearch_url="https://your-elasticsearch-host:9200" \
     elasticsearch_api_key="your-api-key" \
     domain="langwatch.yourdomain.com"
   ```

## Post-Deployment Setup

### DNS Configuration

After deployment, you need to configure your DNS to point to the LangWatch service:

1. Get the LoadBalancer IP:
   ```bash
   make output PROJECT_ID=your-project-id | grep langwatch_loadbalancer_ip
   ```

2. Create an A record in your DNS provider:
   - Type: A
   - Name: The subdomain you specified in `domain` (e.g., "langwatch" for langwatch.yourdomain.com)
   - Value: The LoadBalancer IP from step 1
   - TTL: 300 (5 minutes) or as preferred

3. Wait for DNS propagation (usually 5-15 minutes)

4. Verify the setup:
   ```bash
   curl -I https://your-specified-domain
   ```

Note: The service initially uses HTTP. For HTTPS, you'll need to set up a certificate. We recommend using Cloudflare or similar service for SSL/TLS termination.
