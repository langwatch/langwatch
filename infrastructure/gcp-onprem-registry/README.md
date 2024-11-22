To make your Artifact Registry repository public in GCP, follow these steps:

1. Enable public access for your repositories:
```bash
gcloud artifacts repositories add-iam-policy-binding onprem \
    --project=langwatch \
    --location=europe-west3 \
    --member="allUsers" \
    --role="roles/artifactregistry.reader"
```

2. After making it public, other users can pull your images using:
```bash
docker pull europe-west3-docker.pkg.dev/langwatch/onprem/IMAGE:TAG
```

Important notes:
- Replace langwatch, REPOSITORY_NAME, LOCATION, and IMAGE:TAG with your values
- The repository's location should be specified (e.g., us-central1)
- Making repositories public is irreversible
- Public repositories can be accessed by anyone on the internet
- You'll still be charged for storage and network egress

For Kubernetes users, they can use this image by:
1. No authentication needed
2. Simply specify the full image path in their deployment YAML:
```yaml
image: europe-west3-docker.pkg.dev/langwatch/onprem/IMAGE:TAG
```

Remember that while the repository is public for pulling images, pushing images still requires appropriate authentication.