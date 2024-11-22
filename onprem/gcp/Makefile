# Default values
REGION ?=
ZONE ?=
PROJECT_ID ?=
elasticsearch_url ?=
elasticsearch_api_key ?=
domain ?=

# Validate required variables
.PHONY: validate
validate:
	@if [ -z "$(PROJECT_ID)" -o -z "$(REGION)" -o -z "$(ZONE)" -o -z "$(elasticsearch_url)" -o -z "$(elasticsearch_api_key)" -o -z "$(domain)" ]; then \
		echo "Error: PROJECT_ID, REGION, ZONE, elasticsearch_url, elasticsearch_api_key, and domain are required."; \
		echo "Use: make [command] PROJECT_ID=your-project-id REGION=your-region ZONE=your-zone elasticsearch_url=\"your-es-url\" elasticsearch_api_key=\"your-es-key\" domain=\"langwatch.yourdomain.com\""; \
		exit 1; \
	fi

# Initialize Terraform
.PHONY: init
init: validate
	terraform init

# Plan Terraform changes
.PHONY: plan
plan: validate
	terraform plan \
		-var="project_id=$(PROJECT_ID)" \
		-var="region=$(REGION)" \
		-var="zone=$(ZONE)" \
		-var="elasticsearch_url=$(elasticsearch_url)" \
		-var="elasticsearch_api_key=$(elasticsearch_api_key)" \
		-var="domain=$(domain)"

# Apply Terraform changes
.PHONY: apply
apply: validate
	terraform apply \
		-var="project_id=$(PROJECT_ID)" \
		-var="region=$(REGION)" \
		-var="zone=$(ZONE)" \
		-var="elasticsearch_url=$(elasticsearch_url)" \
		-var="elasticsearch_api_key=$(elasticsearch_api_key)" \
		-var="domain=$(domain)" \
		-auto-approve

# Destroy infrastructure
.PHONY: destroy
destroy: validate
	terraform destroy \
		-var="project_id=$(PROJECT_ID)" \
		-var="region=$(REGION)" \
		-var="zone=$(ZONE)" \
		-var="elasticsearch_url=$(elasticsearch_url)" \
		-var="elasticsearch_api_key=$(elasticsearch_api_key)" \
		-var="domain=$(domain)" \
		-auto-approve

# Show outputs
.PHONY: output
output: validate
	terraform output

# Clean Terraform files
.PHONY: clean
clean:
	rm -rf .terraform
	rm -f terraform.tfstate*
	rm -f .terraform.lock.hcl

# Get kubeconfig
.PHONY: kubeconfig
kubeconfig: validate
	gcloud container clusters get-credentials $(shell terraform output -raw kubernetes_cluster_name) \
		--zone $(ZONE) \
		--project $(PROJECT_ID)

# Help
.PHONY: help
help:
	@echo "LangWatch GCP Infrastructure Deployment"
	@echo ""
	@echo "Usage:"
	@echo "  make [command] PROJECT_ID=your-project-id [REGION=region] [ZONE=zone] elasticsearch_url=your-es-url elasticsearch_api_key=your-es-key domain=langwatch.yourdomain.com"
	@echo ""
	@echo "Commands:"
	@echo "  init       Initialize Terraform"
	@echo "  plan       Show planned changes"
	@echo "  apply      Apply changes"
	@echo "  destroy    Destroy infrastructure"
	@echo "  output     Show outputs"
	@echo "  clean      Clean Terraform files"
	@echo "  kubeconfig Configure kubectl for the GKE cluster"
	@echo ""
	@echo "Required Variables:"
	@echo "  PROJECT_ID  Your Google Cloud project ID"
	@echo "  REGION     GCP region (default: us-central1)"
	@echo "  ZONE       GCP zone (default: us-central1-a)"
	@echo "  elasticsearch_url Elasticsearch URL"
	@echo "  elasticsearch_api_key Elasticsearch API key"
	@echo "  domain     The domain where LangWatch will be hosted (e.g., langwatch.yourdomain.com)"