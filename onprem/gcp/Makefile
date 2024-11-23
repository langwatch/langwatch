# Default values
REGION ?=
ZONE ?=
PROJECT_ID ?=
domain ?=

# Validate required variables and .env.json
.PHONY: validate
validate:
	@if [ ! -f .env.json ]; then \
		echo "Error: .env.json file not found. Copy .env.example.json to .env.json and fill in your values."; \
		exit 1; \
	fi
	@if [ -z "$(PROJECT_ID)" -o -z "$(REGION)" -o -z "$(ZONE)" -o -z "$(domain)" ]; then \
		echo "Error: PROJECT_ID, REGION, ZONE, and domain are required."; \
		echo "Use: make [command] PROJECT_ID=your-project-id REGION=your-region ZONE=your-zone domain=langwatch.yourdomain.com"; \
		exit 1; \
	fi

# Add before init
.PHONY: backend-init
backend-init:
	@if [ -z "$(PROJECT_ID)" -o -z "$(REGION)" ]; then \
		echo "Error: PROJECT_ID and REGION are required."; \
		echo "Use: make backend-init PROJECT_ID=your-project-id REGION=your-region"; \
		exit 1; \
	fi
	gsutil mb -l $(REGION) gs://langwatch-terraform-state-$(PROJECT_ID)
	terraform init \
		-backend-config="bucket=langwatch-terraform-state-$(PROJECT_ID)" \
		-backend-config="prefix=terraform/state"

# Update init to depend on backend check
.PHONY: init
init: validate check-backend
	terraform init \
		-backend-config="bucket=langwatch-terraform-state-$(PROJECT_ID)" \
		-backend-config="prefix=terraform/state"

# Add backend check
.PHONY: check-backend
check-backend:
	@gsutil ls gs://langwatch-terraform-state-$(PROJECT_ID) > /dev/null 2>&1 || \
		(echo "Error: Terraform state bucket not found. Run 'make backend-init' first" && exit 1)

# Plan Terraform changes
.PHONY: plan
plan: validate
	terraform plan \
		-var="project_id=$(PROJECT_ID)" \
		-var="region=$(REGION)" \
		-var="zone=$(ZONE)" \
		-var="domain=$(domain)" \
		-var='extra_env_vars=$(shell cat .env.json)'

# Apply Terraform changes
.PHONY: apply
apply: validate
	terraform apply \
		-var="project_id=$(PROJECT_ID)" \
		-var="region=$(REGION)" \
		-var="zone=$(ZONE)" \
		-var="domain=$(domain)" \
		-var='extra_env_vars=$(shell cat .env.json)' \
		-auto-approve

# Destroy infrastructure
.PHONY: destroy
destroy: validate
	terraform destroy \
		-var="project_id=$(PROJECT_ID)" \
		-var="region=$(REGION)" \
		-var="zone=$(ZONE)" \
		-var="domain=$(domain)" \
		-var='extra_env_vars=$(shell cat .env.json)' \
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
	@echo "  make [command] PROJECT_ID=your-project-id [REGION=region] [ZONE=zone] domain=langwatch.yourdomain.com"
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
	@echo "  domain     The domain where LangWatch will be hosted (e.g., langwatch.yourdomain.com)"
