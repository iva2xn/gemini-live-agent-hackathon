#!/bin/bash
set -e

# Configuration
PROJECT_ID="live-agents-hackathon"
REGION="us-central1"
SERVICE_NAME="nibo-backend"

if [ -z "$PROJECT_ID" ]; then
    echo "Error: Could not determine Google Cloud Project ID."
    echo "Please set it manually using: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "Deploying to Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service Name: $SERVICE_NAME"
echo ""

# Deploy the service
# Note: Cloud Run can build the container directly from source
echo "Starting deployment..."
gcloud run deploy $SERVICE_NAME \
    --source . \
    --project $PROJECT_ID \
    --region $REGION \
    --allow-unauthenticated \
    --set-env-vars="GOOGLE_GENAI_USE_VERTEXAI=TRUE" \
    --set-env-vars="GOOGLE_CLOUD_PROJECT=$PROJECT_ID" \
    --set-env-vars="GOOGLE_CLOUD_LOCATION=$REGION"

echo ""
echo "Deployment specific commands finished."
echo "Check the provided URL above to access the service."
