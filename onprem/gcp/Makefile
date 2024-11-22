# Default values
REGION ?=
ZONE ?=
PROJECT_ID ?=

# Validate required variables
.PHONY: validate
validate:
	@if [ -z "$(PROJECT_ID)" -o -z "$(REGION)" -o -z "$(ZONE)" ]; then \
		echo "Error: PROJECT_ID, REGION, and ZONE are required. Use: make [command] PROJECT_ID=your-project-id REGION=your-region ZONE=your-zone"; \
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
		-var="zone=$(ZONE)"

# Apply Terraform changes
.PHONY: apply
apply: validate
	terraform apply \
		-var="project_id=$(PROJECT_ID)" \
		-var="region=$(REGION)" \
		-var="zone=$(ZONE)" \
		-auto-approve

# Destroy infrastructure
.PHONY: destroy
destroy: validate
	terraform destroy \
		-var="project_id=$(PROJECT_ID)" \
		-var="region=$(REGION)" \
		-var="zone=$(ZONE)" \
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
	@echo "  make [command] PROJECT_ID=your-project-id [REGION=region] [ZONE=zone]"
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
	@echo ""
	@echo "Optional Variables:"
	@echo "  REGION     GCP region (default: us-central1)"
	@echo "  ZONE       GCP zone (default: us-central1-a)"